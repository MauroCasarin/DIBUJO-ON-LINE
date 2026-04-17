import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import { Box, Play, AlertCircle, CheckCircle2, X, Camera, MessageSquare, Video } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- CONFIGURACIÓN ---
// En IA Studio, asegúrate de tener estas dos llaves en "Secrets"
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GROQ_API_KEY = process.env.dibujo || ''; // Usando el nombre que especificaste

declare global {
  interface Window {
    sketchup?: {
      dibujar_geometria: (datos: any) => void;
    };
  }
}

const SYSTEM_PROMPT_GEMINI = `Actúa como un extractor de geometría 3D. 
Analiza la imagen y genera un JSON con los componentes (cuboid o face). 
No te preocupes por la perfección absoluta, enfócate en capturar todas las piezas que veas.
FORMATO: { "geometria": [ { "tipo": "cuboid", "puntos": [x,y,z], "dimensiones": [w,h,d] } ] }`;

const SYSTEM_PROMPT_GROQ = `Eres un Arquitecto e Ingeniero experto en 3D para SketchUp.
Tu tarea es generar JSON de geometría.
FORMATO EXACTO REQUERIDO: { "geometria": [ { "tipo": "cuboid", "puntos": [0,0,0], "dimensiones": [1,1,1] } ] }

Reglas:
1. Si recibes un "Borrador JSON Gemini" con datos, úsalo como molde, fíjalo para que no flote de forma ilógica, aplica las medidas del "Texto Usuario" y genera el JSON limpio.
2. Si el "Borrador JSON Gemini" está VACÍO, significa que NO se mandó imagen. En ese caso, DEBES INVENTAR Y CREAR toda la geometría desde cero, usando la lógica espacial para materializar puramente lo que el "Texto Usuario" te describe.
3. Responde ÚNICAMENTE con el código JSON. Nada de explicaciones, ni comillas Markdown.`;

export default function App() {
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successStatus, setSuccessStatus] = useState<string | null>(null);

  const [isCameraOpen, setIsCameraOpen] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    if (isCameraOpen) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then((mediaStream) => {
          stream = mediaStream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        })
        .catch(() => {
          setError("No se pudo acceder a la cámara. Revisa los permisos.");
          setIsCameraOpen(false);
        });
    }

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [isCameraOpen]);

  const takePhoto = () => {
    if (videoRef.current) {
      const canvas = document.createElement("canvas");
      canvas.width = videoRef.current.videoWidth;
      canvas.height = videoRef.current.videoHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) {
            const file = new File([blob], "captura.jpg", { type: "image/jpeg" });
            setImage(file);
            setImagePreview(URL.createObjectURL(file));
            setIsCameraOpen(false);
          }
        }, "image/jpeg", 0.9);
      }
    }
  };

  const mandarASketchUp = (data: any) => {
    if (window.sketchup?.dibujar_geometria) {
      try {
        window.sketchup.dibujar_geometria(data);
        setSuccessStatus("¡Enviado a SketchUp correctamente!");
      } catch (err) {
        setError("Error al comunicar con SketchUp.");
      }
    } else {
      setSuccessStatus("Análisis completado (Bridge no detectado).");
    }
  };

  const analyzeImage = async () => {
    if (!image && !description.trim()) return;
    setIsAnalyzing(true);
    setError(null);
    setResult(null);
    setSuccessStatus(null);

    try {
      // --- PASO 1: GEMINI (VISIÓN) ---
      let geminiBorrador = "";

      if (image) {
        if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY no configurada.");
        const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
        
        const reader = new FileReader();
        const imageData = await new Promise<{ mimeType: string, data: string }>((resolve) => {
          reader.onloadend = () => resolve({ 
            mimeType: image.type, 
            data: (reader.result as string).split(',')[1] 
          });
          reader.readAsDataURL(image);
        });

        const geminiResult = await genAI.models.generateContent({
          model: "gemini-flash-latest",
          contents: [
            { inlineData: imageData },
            "Analiza esta imagen."
          ],
          config: {
            systemInstruction: SYSTEM_PROMPT_GEMINI,
            responseMimeType: "application/json"
          }
        });
        geminiBorrador = geminiResult.text || "";
      }

      // --- PASO 2: GROQ (REFINAMIENTO LÓGICO Y/O CREACIÓN) ---
      if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY (dibujo) no configurada.");
      
      const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: SYSTEM_PROMPT_GROQ },
            { role: "user", content: `Texto Usuario: ${description || "Sin descripción adicional."}\n\nBorrador JSON Gemini: ${geminiBorrador || "VACÍO (No hay imagen)"}` }
          ],
          temperature: 0.1
        })
      });

      if (!groqResponse.ok) {
        const errorData = await groqResponse.json().catch(() => null);
        throw new Error(`Groq API Error: ${errorData?.error?.message || groqResponse.statusText}`);
      }

      const groqData = await groqResponse.json();
      const rawText = groqData.choices[0].message.content;
      const finalJson = rawText.replace(/```json|```/g, "").trim();
      
      setResult(finalJson);
      if (finalJson.startsWith('{') || finalJson.startsWith('[')) {
        mandarASketchUp(JSON.parse(finalJson));
      } else {
        throw new Error("El JSON devuelto no es válido:\n" + finalJson);
      }

    } catch (err: any) {
      setError(err.message || "Error en el procesamiento.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans p-6">
      <div className="max-w-6xl mx-auto space-y-8">
        <header className="flex items-center gap-4 border-b border-neutral-800 pb-6">
          <Box className="text-red-500 w-8 h-8" />
          <h1 className="text-2xl font-bold tracking-tighter">SKETCHUP <span className="text-neutral-500 font-light">AI BRIDGE PRO</span></h1>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* LADO IZQUIERDO: INPUTS */}
          <div className="space-y-6">
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-widest text-neutral-500 mb-4">Referencia Visual</h2>
              <div className="relative h-64 border-2 border-dashed border-neutral-800 rounded-2xl bg-neutral-900/30 overflow-hidden flex flex-col items-center justify-center transition-all">
                
                {isCameraOpen ? (
                  <div className="absolute inset-0 bg-black z-10 flex flex-col">
                    <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                    <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-4">
                      <button onClick={(e) => { e.stopPropagation(); takePhoto(); }} className="bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-full font-bold shadow-lg transition-all">Capturar</button>
                      <button onClick={(e) => { e.stopPropagation(); setIsCameraOpen(false); }} className="bg-neutral-800 hover:bg-neutral-700 text-white px-6 py-2 rounded-full font-bold shadow-lg transition-all">Cancelar</button>
                    </div>
                  </div>
                ) : imagePreview ? (
                  <div className="relative w-full h-full flex items-center justify-center p-4">
                    <img src={imagePreview} className="max-w-full max-h-full object-contain" alt="Preview" />
                    <button 
                      onClick={(e) => { e.stopPropagation(); setImage(null); setImagePreview(null); if(fileInputRef.current) fileInputRef.current.value = ''; }} 
                      className="absolute top-4 right-4 bg-black/60 hover:bg-red-500 text-white p-2 rounded-full transition-colors backdrop-blur-sm"
                    >
                      <X size={20} />
                    </button>
                  </div>
                ) : (
                  <div className="flex w-full h-full divide-x divide-neutral-800">
                    <div 
                      onClick={() => fileInputRef.current?.click()} 
                      className="flex-1 flex flex-col items-center justify-center group hover:bg-neutral-900/50 cursor-pointer transition-colors"
                    >
                      <Camera className="w-10 h-10 mb-2 opacity-30 group-hover:opacity-60 transition-opacity" />
                      <p className="text-neutral-500 text-sm group-hover:text-neutral-300">Subir Archivo</p>
                    </div>
                    <div 
                      onClick={() => setIsCameraOpen(true)}
                      className="flex-1 flex flex-col items-center justify-center group hover:bg-neutral-900/50 cursor-pointer transition-colors"
                    >
                      <Video className="w-10 h-10 mb-2 opacity-30 group-hover:opacity-60 transition-opacity" />
                      <p className="text-neutral-500 text-sm group-hover:text-neutral-300">Usar Cámara</p>
                    </div>
                  </div>
                )}
                <input type="file" ref={fileInputRef} onChange={(e) => {
                  const file = e.target.files?.[0];
                  if(file) { setImage(file); setImagePreview(URL.createObjectURL(file)); }
                }} className="hidden" accept="image/*" />
              </div>
            </section>

            <section>
              <h2 className="text-sm font-semibold uppercase tracking-widest text-neutral-500 mb-4">Detalles del Diseño</h2>
              <div className="relative">
                <MessageSquare className="absolute top-4 left-4 w-5 h-5 text-neutral-600" />
                <textarea 
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ej: Hazlo de 100x50cm con madera de pino..."
                  className="w-full h-40 bg-neutral-900 border border-neutral-800 rounded-2xl p-4 pl-12 text-neutral-200 focus:ring-2 focus:ring-red-500/20 focus:border-red-500 outline-none transition-all resize-none"
                />
              </div>
            </section>

            <button
              disabled={isAnalyzing || (!image && !description.trim())}
              onClick={analyzeImage}
              className="w-full h-16 bg-white text-black rounded-2xl font-bold text-lg hover:scale-[1.02] active:scale-[0.98] disabled:bg-neutral-800 disabled:text-neutral-600 transition-all flex items-center justify-center gap-3 shadow-xl shadow-white/5"
            >
              {isAnalyzing ? (
                <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }} className="w-6 h-6 border-2 border-neutral-400 border-t-black rounded-full" />
              ) : (
                <><Play fill="black" size={20} /> Generar en SketchUp</>
              )}
            </button>
          </div>

          {/* LADO DERECHO: CONSOLA */}
          <div className="flex flex-col">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-neutral-500 mb-4">Salida Inteligente (Groq Refined)</h2>
            <div className="flex-1 bg-black border border-neutral-800 rounded-2xl p-6 font-mono text-[13px] relative overflow-hidden shadow-inner">
              <AnimatePresence>
                {error && (
                  <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="bg-red-500/10 border border-red-500/50 text-red-400 p-4 rounded-xl mb-4 flex gap-3">
                    <AlertCircle size={18} className="flex-shrink-0" /> <span className="break-words">{error}</span>
                  </motion.div>
                )}
                {successStatus && (
                  <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="bg-green-500/10 border border-green-500/50 text-green-400 p-4 rounded-xl mb-4 flex gap-3">
                    <CheckCircle2 size={18} className="flex-shrink-0" /> {successStatus}
                  </motion.div>
                )}
              </AnimatePresence>
              <pre className="text-blue-400/90 leading-relaxed whitespace-pre-wrap">
                {result || "// Esperando datos de entrada..."}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}