import React, { useState, useRef } from 'react';
import { GoogleGenAI } from '@google/genai';
import { Upload, Box, Play, AlertCircle, CheckCircle2, FileJson, X, Camera } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

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
Analizar la imagen proporcionada por el usuario (planos, bocetos, objetos reales o diagramas) y extraer sus dimensiones, formas y ubicación espacial.

REGLAS DE SALIDA:
1. Debes responder EXCLUSIVAMENTE con un objeto JSON. No incluyas explicaciones, ni etiquetas de código (markdown), ni texto adicional.
2. El JSON debe contener una lista de entidades geométricas bajo la clave "geometria".
3. Formatos soportados: "cuboid" (para volúmenes rectangulares) y "face" (para superficies planas).

ESTRUCTURA DEL JSON REQUERIDA:
{
  "geometria": [
    {
      "tipo": "cuboid",
      "puntos": [0, 0, 0],
      "dimensiones": [x, y, z]
    },
    {
      "tipo": "face",
      "puntos": [[x1, y1, z1], [x2, y2, z2], [x3, y3, z3], [x4, y4, z4]]
    }
  ]
}

CONSIDERACIONES TÉCNICAS:
- Si no hay medidas explícitas en la imagen, asume una escala lógica (ej. una silla mide 0.45m de alto, una pared 2.6m).
- Usa unidades métricas (metros) expresadas como números decimales.
- Prioriza la precisión en las uniones de los objetos para que el modelo 3D sea coherente.`;

export default function App() {
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successStatus, setSuccessStatus] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    loadLocalFile(file);
  };

  const loadLocalFile = (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError("Por favor, sube un archivo de imagen válido (JPG, PNG, WebP).");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    setImagePreview(objectUrl);
    setImage(file);
    setResult(null);
    setError(null);
    setSuccessStatus(null);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      loadLocalFile(file);
    }
  };

  const clearImage = () => {
    setImage(null);
    setImagePreview(null);
    setResult(null);
    setError(null);
    setSuccessStatus(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Esta función debe ejecutarse cuando la IA termine de analizar la imagen
  const procesarResultadoIA = (respuestaJSON: string) => {
    try {
        const datos = JSON.parse(respuestaJSON);
        
        // Verificamos si estamos dentro del entorno de SketchUp
        if (typeof window.sketchup !== 'undefined') {
            // Enviamos los datos al bridge.rb que creamos antes
            window.sketchup.dibujar_geometria(datos);
            setSuccessStatus("Geometría enviada directamente a SketchUp con éxito.");
        } else {
            console.log("Datos generados:", datos);
            setSuccessStatus("Análisis completado. Abre esta interfaz dentro de SketchUp para enviar la geometría automáticamente.");
        }
    } catch (e) {
        console.error("Error al parsear el JSON de la IA", e);
        throw new Error("El modelo falló al devolver un JSON válido. Revisa los logs.");
    }
  };

  const analyzeImage = async () => {
    if (!image) return;
    
    setIsAnalyzing(true);
    setError(null);
    setResult(null);
    setSuccessStatus(null);

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("Missing GEMINI_API_KEY environment variable. Asegúrate de configurarla.");
      }

      const ai = new GoogleGenAI({ apiKey });
      const reader = new FileReader();

      const imagePromise = new Promise<{ mimeType: string, data: string }>((resolve, reject) => {
        reader.onloadend = () => {
          const resultString = reader.result as string;
          const base64Data = resultString.split(',')[1];
          resolve({
             mimeType: image.type,
             data: base64Data
          });
        };
        reader.onerror = reject;
        reader.readAsDataURL(image);
      });

      const imageData = await imagePromise;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: [
          {
            inlineData: {
              data: imageData.data,
              mimeType: imageData.mimeType,
            }
          },
          "Genera el análisis 3D conforme a las reglas solicitadas."
        ],
        config: {
          systemInstruction: SYSTEM_PROMPT,
          responseMimeType: "application/json",
          temperature: 0, 
        }
      });
      
      const responseText = response.text;
      if (responseText) {
         setResult(responseText);
         procesarResultadoIA(responseText);
      } else {
         throw new Error("La respuesta del modelo está vacía.");
      }

    } catch (err: any) {
      console.error(err);
      setError(err.message || "Ocurrió un error al contactar el servicio de IA.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans selection:bg-red-500/30 selection:text-red-200">
      {/* Navbar Minimalista */}
      <nav className="border-b border-neutral-800 bg-neutral-950/50 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-red-600/10 p-2 rounded-lg border border-red-600/20">
              <Box className="w-5 h-5 text-red-500" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-neutral-200">
              SketchUp <span className="text-neutral-500 font-light">AI Bridge</span>
            </h1>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          
          {/* Panel Izquierdo: Input */}
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h2 className="text-2xl font-medium tracking-tight">Carga tu referencia</h2>
              <p className="text-neutral-400 text-sm">
                Sube un plano, boceto a mano alzada o foto de un objeto. La IA extraerá los datos dimensionales para convertirlos en geometría en el entorno de SketchUp.
              </p>
            </div>

            <div 
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`relative flex flex-col group items-center justify-center border-2 border-dashed rounded-xl p-8 transition-colors ${
                isDragOver ? "border-red-500 bg-red-500/5" : "border-neutral-800 hover:border-neutral-700 bg-neutral-900/50 hover:bg-neutral-900"
              } ${imagePreview ? "overflow-hidden border-solid border-neutral-800 p-2" : "min-h-[300px]"}`}
            >
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleImageChange} 
                accept="image/*"
                className="hidden" 
              />
              
              <AnimatePresence mode="wait">
                {imagePreview ? (
                  <motion.div 
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    className="relative w-full aspect-auto rounded-lg overflow-hidden group"
                  >
                    <img 
                      src={imagePreview} 
                      alt="Referencia" 
                      className="w-full max-h-[500px] object-contain bg-neutral-950" 
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm">
                      <button 
                        onClick={clearImage}
                        className="p-3 bg-red-600 hover:bg-red-500 text-white rounded-full transition-transform hover:scale-105 active:scale-95 flex items-center gap-2 font-medium"
                      >
                        <X className="w-5 h-5" />
                        Quitar Imagen
                      </button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className="flex flex-col items-center text-center gap-4 cursor-pointer"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <div className="p-4 rounded-2xl bg-neutral-800/50 text-neutral-400 group-hover:text-red-400 group-hover:scale-110 transition-all">
                      <Camera className="w-8 h-8" />
                    </div>
                    <div>
                      <p className="font-medium text-neutral-300">Arrastra una imagen aquí</p>
                      <p className="text-sm text-neutral-500 mt-1">O haz clic para explorar archivos locales</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <button
              disabled={!image || isAnalyzing}
              onClick={analyzeImage}
              className={`w-full h-14 flex items-center justify-center gap-3 rounded-lg text-lg font-medium transition-all ${
                !image || isAnalyzing
                  ? "bg-neutral-800 text-neutral-500 cursor-not-allowed"
                  : "bg-neutral-100 text-neutral-900 shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_25px_rgba(255,255,255,0.2)] hover:bg-white active:scale-[0.98]"
              }`}
            >
              {isAnalyzing ? (
                <>
                  <div className="w-5 h-5 border-2 border-neutral-500 border-t-transparent rounded-full animate-spin" />
                  Analizando Imagen...
                </>
              ) : (
                <>
                  <Play className="w-5 h-5 fill-current" />
                  Procesar a 3D
                </>
              )}
            </button>
          </div>

          {/* Panel Derecho: Consola y JSON */}
          <div className="flex flex-col gap-6 h-full min-h-[500px]">
            <div className="flex flex-col gap-2">
              <h2 className="text-2xl font-medium tracking-tight">Consola del Bridge</h2>
              <p className="text-neutral-400 text-sm">
                El output JSON crudo que será interceptado por la API de Ruby en SketchUp.
              </p>
            </div>

            <div className="flex-1 bg-[#0A0A0A] border border-neutral-800 rounded-xl overflow-hidden flex flex-col shadow-2xl relative">
              <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800/60 bg-neutral-900/50">
                <div className="flex items-center gap-2">
                  <FileJson className="w-4 h-4 text-neutral-500" />
                  <span className="text-xs font-mono font-medium text-neutral-400 uppercase tracking-widest">
                    Response.json
                  </span>
                </div>
                {result && (
                  <span className="flex h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
                )}
              </div>
              
              <div className="p-4 flex-1 overflow-auto bg-[#0A0A0A]">
                {error && (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-4 rounded-lg bg-red-950/30 border border-red-900/50 flex items-start gap-3 mb-4">
                    <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                    <p className="text-sm font-mono text-red-200">{error}</p>
                  </motion.div>
                )}

                {successStatus && (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-4 rounded-lg bg-green-950/20 border border-green-900/50 flex items-start gap-3 mb-4">
                    <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
                    <p className="text-sm font-sans text-green-200">{successStatus}</p>
                  </motion.div>
                )}

                {isAnalyzing ? (
                  <div className="flex flex-col gap-3 font-mono text-sm opacity-50 animate-pulse pt-4">
                    <div className="h-4 bg-neutral-800 rounded w-1/3"></div>
                    <div className="h-4 bg-neutral-800 rounded w-1/4"></div>
                    <div className="h-4 bg-neutral-800 rounded w-1/2"></div>
                    <div className="h-4 bg-neutral-800 rounded w-2/5"></div>
                  </div>
                ) : result ? (
                  <motion.pre 
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="font-mono text-sm leading-relaxed text-blue-300 whitespace-pre-wrap break-words"
                  >
                    {result}
                  </motion.pre>
                ) : (
                  <div className="h-full flex items-center justify-center text-neutral-600 font-mono text-sm">
                    {`// Esperando ejecución...`}
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
