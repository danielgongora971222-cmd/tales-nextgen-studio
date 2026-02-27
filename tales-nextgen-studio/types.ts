export enum AppRoute {
  HOME = 'home',
  LOGIN = 'login',

  // New Service
  STORE = 'store',
  
  // Tool Categories
  IMAGE_GEN_ROOT = 'image-gen-root',
  VIDEO_GEN = 'video-gen',
  MY_CREATIONS = 'my-creations',
  
  // Specific Tools
  TOOL_GENERATOR = 'tool-generator',
  TOOL_EDITOR = 'tool-editor',
  TOOL_RESTYLER = 'tool-restyler',
  TOOL_LIGHTROOM = 'tool-lightroom',
  TOOL_FACESWAP = 'tool-faceswap',
  TOOL_UPSCALER = 'tool-upscaler',
  TOOL_ANGLES = 'tool-angles',
  TOOL_COLLAGE = 'tool-collage',

  // Video Tools
  TOOL_VIDEO_GENERATOR = 'tool-video-generator',
  TOOL_VIDEO_EDIT = 'tool-video-edit',
  TOOL_INGREDIENTS_TO_VIDEO = 'tool-ingredients-to-video',
  TOOL_EXTEND_VIDEO = 'tool-extend-video',
  TOOL_MOTION_CONTROL = 'tool-motion-control',
  
  CHAT = 'chat'
}

export interface User {
  id: string;
  username: string;
  avatarUrl?: string;
}

export interface Comment {
  id: string;
  userId: string;
  username: string;
  text: string;
  timestamp: number;
}

export interface Asset {
  id: string;
  url: string; 
  type: 'image' | 'video';
  name: string;

  // ✅ importante para Store (y ya existe en DB: public.assets.tool)
  tool?: string;

  prompt?: string;
  createdAt: number;

  meta?: any;

  // Social & Privacy
  ownerId: string;
  isPublic: boolean;

  // Social real (rápido para feed)
  likedByMe: boolean;
  likesCount: number;
  commentsCount: number;

  // Compat: NO asumas lista completa (solo hint/preview)
  likes: string[];
  comments: Comment[];
}

export interface StylePreset {
  id: string;
  name: string;
  coverUrl: string;
  prompt: string;
  category: string;
}

export enum GeminiModel {
  IMAGE = 'gemini-2.5-flash-image',
  IMAGE_PRO = 'gemini-3-pro-image-preview',
  VIDEO_FAST = 'veo-3.1-fast-generate-preview',
  VIDEO_PRO = 'veo-3.1-generate-preview',
  VIDEO_VEO3 = 'veo-3.0-generate-preview',
  TEXT_FAST = 'gemini-3-flash-preview',
  TEXT_PRO = 'gemini-3-pro-preview'
}

declare global {
  interface AIStudio {
    hasSelectedApiKey: () => Promise<boolean>;
    openSelectKey: () => Promise<void>;
  }

  interface Window {
    aistudio?: AIStudio;
  }
}
