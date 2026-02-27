# Project Analysis & Migration Plan

## 1. Legacy Architecture Analysis
The provided project bundle represents a traditional Monolithic PHP application structure.

*   **Backend**: PHP scripts handling both view rendering (HTML mixed with PHP) and API logic (`api/` directory).
*   **Database**: MySQL accessed via PDO.
*   **State Management**: PHP `$_SESSION` for user authentication and temporary data (collage steps).
*   **Frontend**: Vanilla JavaScript + jQuery (implied) + CSS files.
*   **Assets**: Local storage in `public_html/uploads`.

### Key Risks & Security Issues
1.  **Hardcoded Credentials**: API Keys (Gemini) are hardcoded in `config.php` and `generate_image_free.php`. This is a critical security vulnerability.
2.  **Authentication**: Basic session-based auth in `login.php` with hardcoded users (`cesar`, `daniel`). Not scalable or secure.
3.  **File Security**: Direct file uploads to `uploads/` without robust validation or virus scanning. Potential for RCE (Remote Code Execution) if PHP files are uploaded and executed.
4.  **Scalability**:
    *   **Blocking Operations**: PHP scripts likely wait for AI API responses (sync), potentially timing out server threads.
    *   **Local Storage**: Images are stored locally. This breaks if the app scales to multiple server instances.
    *   **State**: Server-side sessions make load balancing difficult (sticky sessions required).

## 2. Migration Plan to Scalable React Architecture

### Phase 1: Frontend Decoupling (This Implementation)
*   **Framework**: React 18 + TypeScript.
*   **Styling**: Tailwind CSS (Black & White "Noir" Aesthetic).
*   **State**: Client-side state (Context API / Zustand) replacing PHP Sessions.
*   **API Integration**: Direct integration with Google GenAI SDK (client-side) for demonstration, using `process.env.API_KEY`.

### Phase 2: Backend & Infrastructure (Future Recommendation)
*   **API Gateway**: Migrate PHP logic to a serverless NodeJS/Python environment (e.g., Next.js API Routes or AWS Lambda).
*   **Queue System**: Implement a job queue (BullMQ/Redis) for Image/Video generation. The UI should poll for status or use WebSockets, rather than keeping an HTTP connection open.
*   **Storage**: Move `uploads/` to AWS S3 or Google Cloud Storage.
*   **Auth**: Replace `login.php` with Auth0, Clerk, or Firebase Auth.
*   **Database**: Migrate MySQL to a managed instance (PlanetScale/Supabase) with Prisma ORM.

### Phase 3: Features Enhancements
*   **Multi-Model Support**: Abstract the AI service to support Gemini, Veo, and Imagen dynamically.
*   **Real-time Collaboration**: WebSocket-based "boards" for team editing.

## 3. Visual Overhaul
The new design implements a strict "Monochrome Noir" aesthetic using 3D background elements, glassmorphism, and high-fidelity animations to provide a premium user experience.
