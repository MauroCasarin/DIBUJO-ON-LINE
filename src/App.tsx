import React, { useState, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import { Box, Play, AlertCircle, CheckCircle2, X, Camera, MessageSquare } from 'lucide-react';
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

const SYSTEM_PROMPT_GROQ = `Eres un Ingeniero Senior de SketchUp. 
Recibirás un borrador JSON de una IA visual y una descripción del usuario.
Tu objetivo es:
1. Validar que las piezas no estén flotando (ajustar coordenadas Z si es necesario).
2. Si el usuario dio medidas específicas en el texto, PRIORIZARLAS sobre el JSON.
3. Asegurar que el JSON sea válido y limpio.
4. Si se mencionan materiales, añádelos como atributo "material" en cada pieza.
Responde ÚNICAMENTE con el JSON final.`;

export default function App() {
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successStatus, setSuccessStatus] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);

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

    try {
      // --- PASO 1: GEMINI (VISIÓN) ---
      const genAI = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      let geminiBorrador = "";

      if (image) {
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

      // --- PASO 2: GROQ (REFINAMIENTO LÓGICO) ---
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
            { role: "user", content: `Texto Usuario: ${description}\n\nBorrador JSON Gemini: ${geminiBorrador}` }
          ],
          temperature: 0.1
        })
      });

      if (!groqResponse.ok) {
        const errorData = await groqResponse.json().catch(() => null);
        throw new Error(`Groq API Error: ${errorData?.error?.message || groqResponse.statusText}`);
      }

      const groqData = await groqResponse.json();
      const finalJson = groqData.choices[0].message.content.replace(/```json|```/g, "").trim();
      
      setResult(finalJson);
      mandarASketchUp(JSON.parse(finalJson));

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
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="group relative h-64 border-2 border-dashed border-neutral-800 rounded-2xl flex items-center justify-center bg-neutral-900/30 hover:bg-neutral-900/50 hover:border-neutral-600 transition-all cursor-pointer overflow-hidden"
              >
                {imagePreview ? (
                  <img src={imagePreview} className="w-full h-full object-contain p-4" alt="Preview" />
                ) : (
                  <div className="text-center text-neutral-500 group-hover:text-neutral-300">
                    <Camera className="w-12 h-12 mx-auto mb-2 opacity-20" />
                    <p>Click para subir plano o boceto</p>
                  </div>
                )}
                <input type="file" ref={fileInputRef} onChange={(e) => {
                  const file = e.target.files?.[0];
                  if(file) { setImage(file); setImagePreview(URL.createObjectURL(file)); }
                }} className="hidden" />
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
              disabled={isAnalyzing || (!image && !description)}
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
                    <AlertCircle size={18} /> {error}
                  </motion.div>
                )}
                {successStatus && (
                  <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="bg-green-500/10 border border-green-500/50 text-green-400 p-4 rounded-xl mb-4 flex gap-3">
                    <CheckCircle2 size={18} /> {successStatus}
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