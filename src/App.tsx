import React, { useState, useRef } from 'react';
import { GoogleGenAI } from '@google/generative-ai';
import { Box, Play, AlertCircle, CheckCircle2, X, Camera } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Extensión global para el bridge con SketchUp
declare global {
  interface Window {
    sketchup?: {
      dibujar_geometria: (datos: any) => void;
    };
  }
}

const SYSTEM_PROMPT = `Eres un experto en visión artificial y programación Ruby para SketchUp Pro. Tu función es actuar como un motor de procesamiento de imagen a 3D.

OBJETIVO:
Analizar la imagen proporcionada por el usuario y extraer sus dimensiones, formas y ubicación espacial.

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
    if (window.sketchup && typeof window.sketchup.dibujar_geometria === 'function') {
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

  const analyzeImage = async () => {
    if (!image) return;
    setIsAnalyzing(true);
    setError(null);
    setResult(null);
    setSuccessStatus(null);

    try {
      // Nota: Asegúrate de que GEMINI_API_KEY esté en tus Environment Variables
      const apiKey = process.env.GEMINI_API_KEY || ''; 
      if (!apiKey) throw new Error("API Key no configurada.");

      const genAI = new GoogleGenAI(apiKey);
      
      // Configuración del modelo con el nombre más estable y modo JSON
      const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash", 
        systemInstruction: SYSTEM_PROMPT,
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1,
        }
      });

      const reader = new FileReader();
      const imageData = await new Promise<{ mimeType: string, data: string }>((resolve) => {
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve({ mimeType: image.type, data: base64 });
        };
        reader.readAsDataURL(image);
      });

      const resultCall = await model.generateContent([
        {
          inlineData: {
            data: imageData.data,
            mimeType: imageData.mimeType,
          }
        },
        "Genera la geometría JSON para esta imagen."
      ]);
      
      const response = await resultCall.response;
      const text = response.text();
      
      setResult(text);
      mandarASketchUp(JSON.parse(text));

    } catch (err: any) {
      console.error(err);
      setError(err.message || "Error al procesar la imagen.");
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
            <h1 className="text-xl font-semibold">SketchUp <span className="text-neutral-500 font-light">AI Bridge</span></h1>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="flex flex-col gap-6">
            <h2 className="text-2xl font-medium tracking-tight">Referencia</h2>
            <div 
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setIsDragOver(false); if(e.dataTransfer.files[0]) loadLocalFile(e.dataTransfer.files[0]); }}
              className={`relative min-h-[300px] border-2 border-dashed rounded-xl flex items-center justify-center transition-all ${isDragOver ? "border-red-500 bg-red-500/5" : "border-neutral-800 hover:border-neutral-700 bg-neutral-900/50"}`}
            >
              {imagePreview ? (
                <div className="relative group p-2">
                  <img src={imagePreview} className="max-h-[500px] object-contain rounded-lg" alt="Preview" />
                  <button onClick={() => { setImage(null); setImagePreview(null); }} className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity rounded-lg">
                    <X className="w-8 h-8 text-white" />
                  </button>
                </div>
              ) : (
                <div className="text-center cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                  <Camera className="w-10 h-10 mx-auto text-neutral-500 mb-2" />
                  <p className="text-neutral-400">Seleccionar imagen</p>
                </div>
              )}
              <input type="file" ref={fileInputRef} onChange={(e) => e.target.files?.[0] && loadLocalFile(e.target.files[0])} className="hidden" accept="image/*" />
            </div>

            <button
              disabled={!image || isAnalyzing}
              onClick={analyzeImage}
              className={`w-full h-14 rounded-lg font-bold flex items-center justify-center gap-2 transition-all ${!image || isAnalyzing ? "bg-neutral-800 text-neutral-500" : "bg-white text-black hover:scale-[1.01]"}`}
            >
              {isAnalyzing ? "Analizando..." : <><Play size={18} fill="black" /> Generar en SketchUp</>}
            </button>
          </div>

          <div className="flex flex-col gap-6">
            <h2 className="text-2xl font-medium tracking-tight">Consola JSON</h2>
            <div className="flex-1 bg-black border border-neutral-800 rounded-xl p-4 font-mono text-sm overflow-auto min-h-[400px]">
              <AnimatePresence>
                {error && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 mb-4 bg-red-900/20 p-3 rounded border border-red-900/50">
                    <AlertCircle className="inline w-4 h-4 mr-2" /> {error}
                  </motion.div>
                )}
                {successStatus && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-green-400 mb-4 bg-green-900/20 p-3 rounded border border-green-900/50">
                    <CheckCircle2 className="inline w-4 h-4 mr-2" /> {successStatus}
                  </motion.div>
                )}
              </AnimatePresence>
              <pre className="text-blue-300 whitespace-pre-wrap">{result || "// Esperando análisis..."}</pre>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}