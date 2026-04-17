import React, { useState, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import { Box, Play, AlertCircle, CheckCircle2, X, Camera, Type } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Extensión global para el bridge con SketchUp
declare global {
  interface Window {
    sketchup?: {
      dibujar_geometria: (datos: any) => void;
    };
  }
}

const SYSTEM_PROMPT = `Eres un experto en diseño 3D, arquitectura efímera y programación Ruby para SketchUp Pro. Tu función es actuar como un motor de procesamiento de texto/imagen a 3D.

OBJETIVO:
Analizar la imagen y/o la descripción/presupuesto textual proporcionado por el usuario y extraer la lista completa de formas y ubicación espacial. Si el usuario te da un "presupuesto de stand" o un pedido verbal detallado, DIBUJA la geometría correspondiente (pisos, paredes, mostradores, tótems, etc.) estimando un encaje espacial lógico si no se especifica explícitamente.

REGLAS DE SALIDA:
1. Responde EXCLUSIVAMENTE con un objeto JSON.
2. Formatos soportados: "cuboid" y "face".

ESTRUCTURA REQUERIDA:
{
  "geometria": [
    {
      "tipo": "cuboid",
      "puntos": [0, 0, 0],
      "dimensiones": [x, y, z]
    }
  ]
}`;

export default function App() {
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [promptText, setPromptText] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successStatus, setSuccessStatus] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadLocalFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError("Por favor, sube un archivo de imagen válido.");
      return;
    }
    setImagePreview(URL.createObjectURL(file));
    setImage(file);
    setResult(null);
    setError(null);
    setSuccessStatus(null);
  };

  const mandarASketchUp = (data: any) => {
    // Relajar validación typeof porque CEF/SketchUp a veces lo detecta como object/proxy
    if (window.sketchup && window.sketchup.dibujar_geometria) {
      try {
        window.sketchup.dibujar_geometria(data);
        setSuccessStatus("¡Enviado a SketchUp correctamente!");
      } catch (err) {
        setError("Error de comunicación con SketchUp.");
      }
    } else {
      setSuccessStatus("Análisis listo (Bridge no detectado fuera de SketchUp).");
    }
  };

  const analyzeInput = async () => {
    if (!image && !promptText.trim()) return;
    setIsAnalyzing(true);
    setError(null);
    setResult(null);
    setSuccessStatus(null);

    try {
      const apiKey = process.env.GEMINI_API_KEY || ''; 
      if (!apiKey) throw new Error("API Key no configurada.");

      const ai = new GoogleGenAI({ apiKey });

      const modelContents: any[] = [];
      
      if (image) {
        const reader = new FileReader();
        const imageData = await new Promise<{ mimeType: string, data: string }>((resolve) => {
          reader.onloadend = () => {
            const base64 = (reader.result as string).split(',')[1];
            resolve({ mimeType: image.type, data: base64 });
          };
          reader.readAsDataURL(image);
        });
        modelContents.push({
          inlineData: {
            data: imageData.data,
            mimeType: imageData.mimeType,
          }
        });
      }

      if (promptText.trim()) {
        modelContents.push(`Descripción/Presupuesto del usuario:\n${promptText.trim()}\n\nBasándote en esto, genera la geometría 3D completa en JSON.`);
      } else {
        modelContents.push("Genera la geometría JSON tridimensional para la imagen proporcionada.");
      }

      const response = await ai.models.generateContent({
        model: "gemini-flash-latest",
        contents: modelContents,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: "application/json",
          temperature: 0.1, 
        }
      });
      
      const text = response.text || "";
      setResult(text);
      mandarASketchUp(JSON.parse(text));

    } catch (err: any) {
      console.error(err);
      setError(err.message || "Error al procesar la información.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans">
      <nav className="border-b border-neutral-800 bg-neutral-950/50 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Box className="w-5 h-5 text-red-500" />
            <h1 className="text-xl font-semibold tracking-tight">SketchUp <span className="text-neutral-500 font-light">AI Bridge</span></h1>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h2 className="text-2xl font-medium tracking-tight">Datos del Diseño</h2>
              <p className="text-neutral-400 text-sm">
                Sube una imagen, escribe la descripción de un diseño/presupuesto, o ambos.
              </p>
            </div>

            <div className="flex flex-col gap-4">
              <div 
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setIsDragOver(false); if(e.dataTransfer.files[0]) loadLocalFile(e.dataTransfer.files[0]); }}
                className={`relative flex-1 min-h-[220px] border-2 border-dashed rounded-xl flex items-center justify-center transition-all ${isDragOver ? "border-red-500 bg-red-500/5" : "border-neutral-800 hover:border-neutral-700 bg-neutral-900/50"}`}
              >
                {imagePreview ? (
                  <div className="relative group p-2 w-full h-full flex items-center justify-center">
                    <img src={imagePreview} className="max-h-[200px] object-contain rounded-lg" alt="Preview" />
                    <button onClick={() => { setImage(null); setImagePreview(null); }} className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-lg">
                      <X className="w-8 h-8 text-white" />
                    </button>
                  </div>
                ) : (
                  <div className="text-center cursor-pointer p-6 w-full" onClick={() => fileInputRef.current?.click()}>
                    <Camera className="w-8 h-8 mx-auto text-neutral-500 mb-2" />
                    <p className="text-neutral-400 text-sm">Click o arrastra tu imagen (Opcional)</p>
                  </div>
                )}
                <input type="file" ref={fileInputRef} onChange={(e) => e.target.files?.[0] && loadLocalFile(e.target.files[0])} className="hidden" accept="image/*" />
              </div>

              <div className="relative">
                <div className="absolute top-4 left-4">
                  <Type className="w-5 h-5 text-neutral-600" />
                </div>
                <textarea 
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  placeholder="Pega aquí el presupuesto del stand o describe libremente lo que quieres construir..."
                  className="w-full bg-neutral-900/50 hover:bg-neutral-900 border border-neutral-800 focus:border-red-500/50 focus:bg-neutral-900 rounded-xl py-4 pl-12 pr-4 text-neutral-200 outline-none resize-y min-h-[140px] text-sm transition-all"
                />
              </div>
            </div>

            <button
              disabled={(!image && !promptText.trim()) || isAnalyzing}
              onClick={analyzeInput}
              className={`w-full h-14 rounded-lg font-bold flex items-center justify-center gap-2 transition-all ${(!image && !promptText.trim()) || isAnalyzing ? "bg-neutral-800 text-neutral-500" : "bg-white text-black hover:scale-[1.01]"}`}
            >
              {isAnalyzing ? "Analizando..." : <><Play size={18} fill="black" /> Generar en SketchUp</>}
            </button>
          </div>

          <div className="flex flex-col gap-6 h-full min-h-[500px]">
            <h2 className="text-2xl font-medium tracking-tight">Consola JSON</h2>
            <div className="flex-1 bg-black border border-neutral-800 rounded-xl p-4 font-mono text-sm overflow-auto shadow-inner flex flex-col">
              <AnimatePresence>
                {error && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 mb-4 bg-red-900/20 p-3 rounded border border-red-900/50 flex-shrink-0">
                    <AlertCircle className="inline w-4 h-4 mr-2" /> {error}
                  </motion.div>
                )}
                {successStatus && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-green-400 mb-4 bg-green-900/20 p-3 rounded border border-green-900/50 flex-shrink-0">
                    <CheckCircle2 className="inline w-4 h-4 mr-2" /> {successStatus}
                  </motion.div>
                )}
              </AnimatePresence>
              <pre className="text-blue-300 whitespace-pre-wrap flex-1">{result || "// Esperando datos de entrada..."}</pre>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}