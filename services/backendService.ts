import { Asset, StylePreset, User, Comment } from '../types';

const ASSETS_KEY = 'tales_db_assets';
const USERS_KEY = 'tales_db_users';
const CURRENT_USER_KEY = 'tales_session_user';

// Mock Styles (Static)
const MOCK_STYLES: StylePreset[] = [
  { id: 's1', name: 'Cyberpunk Noir', category: 'Cinematic', coverUrl: 'https://picsum.photos/seed/cyber/150', prompt: 'cyberpunk style, neon lights, rain, high contrast, futuristic, dark atmosphere' },
  { id: 's2', name: 'Watercolor', category: 'Artistic', coverUrl: 'https://picsum.photos/seed/water/150', prompt: 'watercolor painting style, soft edges, pastel colors, artistic paper texture, dreamy' },
  { id: 's3', name: 'Studio Ghibli', category: 'Anime', coverUrl: 'https://picsum.photos/seed/ghibli/150', prompt: 'studio ghibli anime style, vibrant colors, detailed background, hand drawn animation style' },
  { id: 's4', name: 'Polaroid Vintage', category: 'Photography', coverUrl: 'https://picsum.photos/seed/pola/150', prompt: 'vintage polaroid photo, film grain, flash photography, nostalgia, soft focus, vignette' },
];

// Helper to access DB
const getDbAssets = (): Asset[] => {
  try { return JSON.parse(localStorage.getItem(ASSETS_KEY) || '[]'); } catch { return []; }
};
const saveDbAssets = (assets: Asset[]) => {
  // TEMPORAL (solo para pruebas en local):
  // Guardamos las imágenes base64 para que el historial sobreviva al refresh.
  // OJO: localStorage tiene límite, por eso guardamos solo las últimas 10.
  const MAX_STORED_ASSETS = 10;
  const trimmed = assets.slice(0, MAX_STORED_ASSETS);

  localStorage.setItem(ASSETS_KEY, JSON.stringify(trimmed));
};

const getDbUsers = (): User[] => {
  try { return JSON.parse(localStorage.getItem(USERS_KEY) || '[]'); } catch { return []; }
};

export const backend = {
  
  // --- AUTHENTICATION ---
  auth: {
    async login(username: string): Promise<User> {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          let users = getDbUsers();
          let user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
          
          if (!user) {
            reject(new Error("User not found. Please register."));
            return;
          }
          
          localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
          resolve(user);
        }, 800);
      });
    },

    async register(username: string): Promise<User> {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          let users = getDbUsers();
          let existing = users.find(u => u.username.toLowerCase() === username.toLowerCase());
          
          if (existing) {
             reject(new Error("Username already taken."));
             return;
          }

          const newUser: User = {
            id: crypto.randomUUID(),
            username: username,
            avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`
          };
          
          users.push(newUser);
          localStorage.setItem(USERS_KEY, JSON.stringify(users));
          localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(newUser));
          
          resolve(newUser);
        }, 1000);
      });
    },

    async logout(): Promise<void> {
      localStorage.removeItem(CURRENT_USER_KEY);
    },

    getCurrentUser(): User | null {
      try { return JSON.parse(localStorage.getItem(CURRENT_USER_KEY) || 'null'); } catch { return null; }
    }
  },

  // --- ASSETS & STORAGE ---
  async saveGeneratedAsset(fileOrUrl: string, type: 'image' | 'video', userId: string, prompt?: string): Promise<Asset> {
     const asset: Asset = {
        id: crypto.randomUUID(),
        url: fileOrUrl,
        type,
        name: `Generation ${Date.now().toString().slice(-4)}`,
        prompt: prompt,
        createdAt: Date.now(),
        ownerId: userId,
        isPublic: false,
        likes: [],
        comments: []
     };

     const assets = getDbAssets();
     saveDbAssets([asset, ...assets]);
     return asset;
  },

  // For uploading files from FileUploader
  async uploadAsset(file: File, userId: string): Promise<Asset> {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            const asset: Asset = {
              id: crypto.randomUUID(),
              url: result,
              type: file.type.startsWith('video') ? 'video' : 'image',
              name: file.name,
              createdAt: Date.now(),
              ownerId: userId,
              isPublic: false,
              likes: [],
              comments: []
            };
            const assets = getDbAssets();
            saveDbAssets([asset, ...assets]);
            resolve(asset);
          };
          reader.readAsDataURL(file);
        } catch (e) {
          reject(e);
        }
      }, 1000);
    });
  },

  async getUserAssets(userId: string): Promise<Asset[]> {
    const all = getDbAssets();
    return all.filter(a => a.ownerId === userId);
  },

  async getPublicFeed(): Promise<Asset[]> {
    try {
      const resp = await fetch(`/api/community?type=image&limit=50`, { method: "GET" });
      const text = await resp.text();

      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(
          `El backend devolvió HTML en vez de JSON (probable: /api/community no existe aún o Vercel/Proxy no está reescribiendo). Inicio: ${text.slice(0, 30)}`
        );
      }

      if (!resp.ok || data?.ok === false) {
        const e = data?.error;
        throw new Error(e?.message || `Request failed: ${resp.status}`);
      }

      return Array.isArray(data.items) ? data.items : [];
    } catch (e) {
      // fallback (por si estás offline o el API no responde)
      const all = getDbAssets();
      return all.filter((a) => a.isPublic).sort((a, b) => b.createdAt - a.createdAt);
    }
  },

  // --- SOCIAL ACTIONS ---
  social: {
    async publishAsset(assetId: string): Promise<void> {
       const assets = getDbAssets();
       const index = assets.findIndex(a => a.id === assetId);
       if (index !== -1) {
           assets[index].isPublic = true;
           saveDbAssets(assets);
       }
    },

    async toggleLike(assetId: string, userId: string): Promise<Asset | null> {
       const assets = getDbAssets();
       const index = assets.findIndex(a => a.id === assetId);
       if (index !== -1) {
           const asset = assets[index];
           if (asset.likes.includes(userId)) {
               asset.likes = asset.likes.filter(id => id !== userId);
           } else {
               asset.likes.push(userId);
           }
           saveDbAssets(assets);
           return asset;
       }
       return null;
    },

    async addComment(assetId: string, user: User, text: string): Promise<Asset | null> {
        const assets = getDbAssets();
        const index = assets.findIndex(a => a.id === assetId);
        if (index !== -1) {
            const comment: Comment = {
                id: crypto.randomUUID(),
                userId: user.id,
                username: user.username,
                text,
                timestamp: Date.now()
            };
            assets[index].comments.push(comment);
            saveDbAssets(assets);
            return assets[index];
        }
        return null;
    }
  },

  async getStyles(): Promise<StylePreset[]> {
    return new Promise(resolve => setTimeout(() => resolve(MOCK_STYLES), 200));
  },

  async getAssetData(assetUrl: string): Promise<string> {
      if (assetUrl.startsWith('data:')) return assetUrl;
      try {
          const resp = await fetch(assetUrl);
          const blob = await resp.blob();
          return new Promise(resolve => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.readAsDataURL(blob);
          });
      } catch (e) {
          return assetUrl; // Fallback
      }
  }
};