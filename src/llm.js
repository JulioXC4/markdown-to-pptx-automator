import { GoogleGenAI, Type } from '@google/genai';
import * as p from '@clack/prompts';

/**
 * Helper interno para llamar a la API de Gemini con reintentos y fallback de modelos
 */
/**
 * Helper interno para llamar a la API de Gemini con reintentos y fallback de modelos
 */
async function callGeminiWithFallback(ai, prompt, responseSchema, preferredModel) {
  const defaultModels = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];
  const modelsList = preferredModel 
    ? [preferredModel, ...defaultModels].filter((val, idx, self) => self.indexOf(val) === idx)
    : defaultModels;
    
  let lastError = null;

  for (const model of modelsList) {
    p.log.info(`[INFO] Intentando procesamiento con el modelo: ${model}...`);
    
    // Intentar hasta 3 veces con exponencial backoff para errores transitorios
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await ai.models.generateContent({
          model: model,
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: responseSchema
          }
        });
        return response;
      } catch (error) {
        lastError = error;
        
        const status = error.status || (error.response && error.response.status);
        const isTransient = status === 503 || status === 429 || 
                            (error.message && (
                              error.message.includes('503') || 
                              error.message.includes('429') || 
                              error.message.toLowerCase().includes('rate limit') || 
                              error.message.toLowerCase().includes('unavailable') ||
                              error.message.toLowerCase().includes('overloaded')
                            ));

        if (isTransient && attempt < 2) {
          const delay = 2000 * Math.pow(2, attempt);
          p.log.warn(`[WARN] Error temporal (${status || 'API Error'}) en ${model}. Reintentando en ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          p.log.warn(`[WARN] El modelo ${model} fallo la ejecucion: ${error.message}`);
          break; // Romper bucle de reintentos e ir al siguiente modelo
        }
      }
    }
  }

  throw lastError || new Error('Todos los modelos de Gemini fallaron al procesar la peticion.');
}

/**
 * Utiliza Gemini API para resumir el texto en diapositivas con imágenes asociadas y recopilar tokens
 * Implementa un pipeline de Doble Pasada (Multi-pass) con un Agente Revisor (Profesor Universitario).
 * @param {string} content - El contenido consolidado de Markdown
 * @param {string[]} imageList - Listado de rutas de imágenes disponibles
 * @param {string} presentationTitle - Título general de la presentación
 * @param {string} course - Curso o temática académica
 * @param {string} modelName - Nombre del modelo preferido
 * @param {string} apiKey - API Key de Gemini
 * @returns {Promise<Object>} Un objeto con la estructura { slides: [...], usage: { ... } }
 */
export async function summarizeContent(content, imageList, presentationTitle, course, modelName, apiKey) {
  const ai = new GoogleGenAI({ apiKey });
  
  // prompt1: Agente Extractor
  const prompt1 = `
Actúa como un diseñador de presentaciones profesional y experto técnico en resumir documentación compleja (Agente Extractor).
Quiero que crees un borrador inicial de presentación de diapositivas basada en el siguiente contenido extraído de un repositorio de documentación.

Título de la presentación: "${presentationTitle}"

--- CONTENIDO DE DOCUMENTACIÓN ---
${content}
----------------------------------

--- IMÁGENES DISPONIBLES EN EL CONTENIDO ---
${imageList.length > 0 ? imageList.join('\n') : 'No hay imágenes disponibles.'}
---------------------------------------------

Instrucciones específicas:
1. Divide el contenido en una serie lógica y coherente de diapositivas.
2. PAGINACIÓN DINÁMICA: Si el contenido de una sección es muy extenso, complejo o detallado, NO intentes forzar todo en una sola diapositiva. Divídelo lógicamente en 2 o 3 diapositivas continuas (ej. "Pruebas Unitarias - Parte 1", "Pruebas Unitarias - Parte 2"). Esto permitirá que el contenido respire y sea más legible. No exageres creando más de 3 diapositivas por sección.
3. OPTIMIZACIÓN DEL TAMAÑO DE LA PRESENTACIÓN: Mantén la presentación en un rango conciso y manejable. Prioriza la calidad y la síntesis de información sobre la cantidad. Diseña aproximadamente 1 diapositiva por cada 2 o 3 secciones del índice analizado. En cualquier caso, el número total de diapositivas de la presentación completa NO debe exceder de 15 a 20 diapositivas.
4. TIPOS DE DIAPOSITIVAS:
   - "bullet": Diapositiva clásica con título, de 3 a 5 viñetas y una imagen opcional a la derecha. Cada viñeta debe ser concisa (evita textos largos de más de una o dos líneas). REGLA DE BALANCE DE TEXTO: Si la diapositiva no contiene imágenes (associatedImage es null), tienes mayor espacio visual disponible; aprovecha para generar explicaciones más detalladas, agregar 1 o 2 bullet points adicionales o profundizar en el contexto técnico, en lugar de resumirlo en exceso. Si la diapositiva tiene imagen, mantén el texto conciso (3-4 bullet points cortos).
   - "image-focus": Utiliza este tipo si una imagen disponible representa un diagrama complejo, arquitectura, flujo, interfaz de usuario o dashboard crucial. En este caso, la diapositiva se enfocará en mostrar esa imagen grande, con un título arriba y una única viñeta corta como leyenda explicativa o descripción abajo de la imagen.
5. CORRELACIÓN DE IMÁGENES: Al asignar una imagen a un slide, asegúrate de que el nombre del archivo o la ruta (ej. 'auth-test.png' o 'audit-problem.png') tenga correlación lógica y contextual directa con los bullet points que estás resumiendo en esa diapositiva específica.
6. Para cada diapositiva:
   - Define un título corto y directo (máximo 45 caracteres).
   - Asocia la imagen correspondiente de la lista de "IMÁGENES DISPONIBLES". Para las diapositivas de tipo "image-focus", associatedImage es OBLIGATORIA. Si es tipo "bullet" y no hay imagen relevante, pon null.
7. El resultado debe cumplir estrictamente con el esquema JSON proporcionado.
`;

  const slidesSchema = {
    type: Type.OBJECT,
    properties: {
      slides: {
        type: Type.ARRAY,
        description: 'Lista de diapositivas para la presentación',
        items: {
          type: Type.OBJECT,
          properties: {
            type: {
              type: Type.STRING,
              description: 'El tipo de diseño de la diapositiva: "bullet" para texto o "image-focus" para resaltar un diagrama/imagen importante.',
              enum: ['bullet', 'image-focus']
            },
            title: {
              type: Type.STRING,
              description: 'Título descriptivo de la diapositiva (máximo 45 caracteres).'
            },
            bullets: {
              type: Type.ARRAY,
              description: 'De 3 a 5 puntos clave para el tipo "bullet". Una única viñeta descriptiva (leyenda) para el tipo "image-focus".',
              items: { type: Type.STRING }
            },
            associatedImage: {
              type: Type.STRING,
              description: 'La ruta exacta de la imagen asociada tomada del bloque "IMÁGENES DISPONIBLES", o null si no aplica ninguna.',
              nullable: true
            }
          },
          required: ['type', 'title', 'bullets', 'associatedImage']
        }
      }
    },
    required: ['slides']
  };

  p.log.info('[INFO] Iniciando Pasada 1 (Extraccion y estructuracion base)...');
  const response1 = await callGeminiWithFallback(ai, prompt1, slidesSchema, modelName);
  const parsedBase = JSON.parse(response1.text);
  
  p.log.info('[INFO] Pasada 1 completada con exito.');
  
  // prompt2: Agente Revisor (Profesor)
  const prompt2 = `
Eres un profesor universitario experto en ${course}. Revisa este borrador de presentación de un proyecto de software.
Tu objetivo es enriquecer, expandir y dar un tono académico profesional a los textos de cada diapositiva.
Si una diapositiva tiene poco texto, expándelo con terminología adecuada al curso.
NO cambies el mapeo de las imágenes (mantén exactamente los valores de associatedImage), NO inventes funcionalidades técnicas que no estén en el texto original, solo mejora y expande la explicación existente.

--- BORRADOR DE DIAPOSITIVAS (JSON) ---
${JSON.stringify(parsedBase, null, 2)}
----------------------------------------

Entrega el resultado en estricto formato JSON respetando el mismo esquema.
`;

  // Animación del Agente Revisor
  console.log(`\n\x1b[1m\x1b[35m[EXPERT]\x1b[0m El modelo \x1b[36m${modelName}\x1b[0m está revisando y elevando el nivel académico de tus diapositivas...\n`);

  p.log.info('[INFO] Iniciando Pasada 2 (Revision academica por el Agente Revisor)...');
  const response2 = await callGeminiWithFallback(ai, prompt2, slidesSchema, modelName);
  const parsedFinal = JSON.parse(response2.text);
  
  p.log.info('[INFO] Pasada 2 completada con exito.');

  // Combinar consumo de tokens de ambas pasadas
  const usage = {
    promptTokenCount: (response1.usageMetadata?.promptTokenCount || 0) + (response2.usageMetadata?.promptTokenCount || 0),
    candidatesTokenCount: (response1.usageMetadata?.candidatesTokenCount || 0) + (response2.usageMetadata?.candidatesTokenCount || 0),
    cachedContentTokenCount: (response1.usageMetadata?.cachedContentTokenCount || 0) + (response2.usageMetadata?.cachedContentTokenCount || 0),
    totalTokenCount: (response1.usageMetadata?.totalTokenCount || 0) + (response2.usageMetadata?.totalTokenCount || 0)
  };

  return {
    slides: parsedFinal.slides,
    usage: usage
  };
}
