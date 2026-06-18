# Markdown to PPTX Automator CLI

Markdown to PPTX Automator es una potente herramienta de interfaz de línea de comandos (CLI) escrita en Node.js que convierte de forma automatizada documentación técnica en formato Markdown alojada en GitHub en presentaciones de PowerPoint (`.pptx`) estilizadas y estructuradas por Inteligencia Artificial.

El principal objetivo de la herramienta es optimizar la creación de diapositivas para reuniones, exposiciones o entregas de proyectos, permitiendo a los desarrolladores y equipos pasar de documentos técnicos densos a presentaciones listas para exponer en minutos, con la opción de importarlas en **Canva** de forma 100% gratuita.

---

## 🚀 Características Principales (Features)

* **Descarga e Indexación de GitHub**: Analiza el índice central (`00-cover.md` u otro) del repositorio para identificar secciones específicas (ej. 5.1 a 6.1.1), mapear qué archivos físicos les corresponden y extraer su contenido.
* **Extracción Multiplataforma de Imágenes**: Detecta automáticamente imágenes referenciadas en el Markdown (tanto en sintaxis estándar como en etiquetas HTML `<img>`), resolviendo rutas relativas complejas locales del repositorio o descargándolas desde URLs externas (ej. Imgur).
* **Resiliencia y Reintentos Inteligentes (Retry/Backoff)**: Mitiga errores de red y límites de API (ej. código HTTP `429` de rate-limiting) mediante reintentos automáticos con retroceso exponencial (*Exponential Backoff*).
* **Sistema de Caché Inteligente (Resume/New)**: Guarda el estado de la descarga del texto y las imágenes en `.cache_payload.json`. Si el script se interrumpe, al reiniciar ofrecerá reanudar directamente desde la fase del LLM o descartar el progreso para realizar una nueva descarga limpia.
* **Modelos de Contingencia (IA Fallbacks)**: Si el modelo de IA predeterminado falla por saturación o error `503 Service Unavailable`, la herramienta realiza reintentos y rota de forma automática entre una lista de candidatos alternativos (`gemini-2.5-flash`, `gemini-1.5-flash`, `gemini-1.5-pro`).
* **Degradación Elegante (Raw Fallback)**: En caso de caída total de la API de IA, la aplicación permite generar una presentación "cruda" a partir del Markdown estructurado por encabezados y secciones de forma local, asegurando que nunca pierdas tu trabajo.
* **Layouts de Diseño Adaptativos**: Genera diapositivas con tipografía, espaciados y paleta de colores premium. Soporta layouts adaptativos automáticos: de dos columnas si la diapositiva tiene imágenes (preservando su relación de aspecto original con `contain`), de una columna si es solo texto, o de tipo `image-focus` para centrar diagramas y capturas de pantalla a tamaño completo.
* **Seguimiento Detallado de Tokens**: Informa detalladamente en consola al terminar el uso de tokens de prompt, tokens recuperados desde caché de contexto, tokens de salida y el total consumido.

---

## 📋 Requisitos Previos (Prerequisites)

Para ejecutar esta herramienta, necesitarás:
1. **Node.js**: Versión 18.0.0 o superior instalada.
2. **GitHub Personal Access Token (PAT)**:
   * Ve a **GitHub ➔ Settings ➔ Developer Settings ➔ Personal Access Tokens (Tokens classic)**.
   * Genera un nuevo token con permisos de lectura (`repo`) para acceder a tu repositorio objetivo.
3. **Gemini API Key**:
   * Obtén una clave de API gratuita en el portal de [Google AI Studio](https://aistudio.google.com/).

---

## 📦 Instalación y Configuración

1. **Clona** este repositorio en tu máquina local:
   ```bash
   git clone https://github.com/tu-usuario/MarkdownToPptxAutomator.git
   cd MarkdownToPptxAutomator
   ```
2. **Instala** las dependencias requeridas del proyecto:
   ```bash
   npm install
   ```
3. **Configura** las variables de entorno:
   * Duplica el archivo `.env.example` y renómbralo a `.env`:
     ```bash
     cp .env.example .env
     ```
   * Abre el archivo `.env` y añade tus credenciales correspondientes:
     ```env
     GITHUB_TOKEN=tu_personal_access_token_de_github
     GEMINI_API_KEY=tu_api_key_de_gemini
     ```

---

## 🎮 Uso (Usage)

Para iniciar la aplicación, ejecuta el siguiente comando en la raíz del proyecto:
```bash
npm start
```

### Ejemplo de Flujo de Interacción

Al iniciar, el programa te guiará paso a paso a través de la terminal:
1. **Detección de caché (opcional)**: Si el script detecta una ejecución anterior incompleta, mostrará:
   `[INFO] Se detectó información local de: organizacion/proyecto (Secciones 5.1 a 6.2).`
   Te preguntará si deseas reanudar o ignorar los datos.
2. **Introducción del Repositorio**: `owner/repo` (ej. `facebook/react`).
3. **Rama Git**: Por defecto `main`.
4. **Archivo Índice (TOC)**: Archivo donde reside la tabla de contenidos. Por defecto `00-cover.md`.
5. **Título de la Presentación**: Título para la portada de las diapositivas.
6. **Rango de Secciones**: Introduce la sección inicial (ej. `5.1`) y la sección final (ej. `6.1.1`).

### Flujo de Trabajo Técnico Interno

```
[Inicio CLI] ➔ [Validar .env] ➔ [Leer TOC en GitHub] 
                 │
  ┌──────────────┴──────────────┐
  ▼ (Si no hay caché)           ▼ (Si se elige reanudar caché)
[Descargar Archivos .md]     [Validar/Descargar imágenes faltantes]
[Descargar imágenes y assets]    │
[Guardar caché local]            │
  │                              │
  └──────────────┬───────────────┘
                 ▼
[Resumir con Gemini (Flash/Pro)] ➔ [Falla API?] ➔ Sí ➔ [Preguntar generar diapositivas crudas]
                 │                                      │
                 No                                     │
                 ▼                                      ▼
[Generar presentacion.pptx] ◄───────────────────────────┘
[Limpiar archivos temporales]
[Reporte de Tokens Consumidos]
```

---

## 📂 Estructura del Proyecto

* **`src/index.js`**: El orquestador principal. Controla el flujo asíncrono, los estados de los spinners, la caché y gestiona la limpieza final en bloque `finally` para evitar archivos temporales huérfanos.
* **`src/cli.js`**: Maneja la interacción en terminal usando la librería `@clack/prompts` e implementa la detección de caché e inicializaciones del CLI libres de emojis para mantener un tono profesional.
* **`src/github.js`**: Interactúa con la API de GitHub para descargar y analizar el índice (`00-cover.md`), resolver rutas de imágenes locales relativas basándose en la ubicación del markdown y segmentar el texto consolidado.
* **`src/llm.js`**: Módulo de IA que se comunica con el SDK oficial `@google/genai`. Implementa el balance dinámico de texto (más detalle si no hay imagen, concisión si la hay), reintentos con exponencial backoff y rotación inteligente de modelos.
* **`src/pptx.js`**: Motor gráfico que utiliza `pptxgenjs` para construir la presentación 16:9 de forma directa en disco. Valida permisos del directorio, maneja el control de EBUSY ante archivos bloqueados en PowerPoint y expone un callback para animar el progreso del spinner.
* **`src/utils.js`**: Utilidades auxiliares que descargan archivos binarios de imágenes (locales y externas) implementando reintentos ante error `429` y resiliencia para no detenerse ante errores `404`.

---

## 🤝 Contribución

Si deseas contribuir a este proyecto:
1. Haz un **Fork** del repositorio.
2. Crea una rama para tu mejora: `git checkout -b feature/nueva-mejora`.
3. Haz commit de tus cambios de forma limpia.
4. Sube la rama: `git push origin feature/nueva-mejora`.
5. Envía un **Pull Request** detallando tus modificaciones.

Si encuentras algún problema o bug, no dudes en abrir un **Issue** en la sección correspondiente de GitHub.
