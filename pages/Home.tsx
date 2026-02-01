import React, { useEffect, useState } from 'react';
import { AppRoute, Asset, User } from '../types';
import { backend } from '../services/backendService';
import { useAuth } from '../contexts/AuthContext';

interface HomeProps {
  onNavigate: (route: AppRoute) => void;
}

const Home: React.FC<HomeProps> = ({ onNavigate }) => {
  const { user } = useAuth();
  const [feed, setFeed] = useState<Asset[]>([]);
  const [commentText, setCommentText] = useState<{[key:string]: string}>({}); // Map assetId -> text

  useEffect(() => {
    loadFeed();
  }, []);

  const loadFeed = () => {
      backend.getPublicFeed().then(setFeed);
  };

  const handleLike = async (assetId: string) => {
      if (!user) return;
      await backend.social.toggleLike(assetId, user.id);
      loadFeed(); // Refresh to show new count
  };

  const handleComment = async (assetId: string) => {
      if (!user) return;
      const text = commentText[assetId];
      if (!text?.trim()) return;

      await backend.social.addComment(assetId, user, text);
      setCommentText(prev => ({ ...prev, [assetId]: '' }));
      loadFeed();
  };

  return (
    <div className="space-y-12 pb-20">
      {/* Hero Section */}
      <section className="relative overflow-hidden rounded-3xl border border-white/10 glass-panel p-12 text-center md:text-left">
        <div className="relative z-10 max-w-3xl">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tighter mb-4 bg-gradient-to-r from-white via-gray-400 to-gray-600 bg-clip-text text-transparent">
            WELCOME, {user?.username.toUpperCase()}.
          </h1>
          <p className="text-lg text-gray-400 mb-8 max-w-xl leading-relaxed">
            Explore the community creations or start your own masterpiece. 
            All your generations are saved privately until you choose to share.
          </p>
          <div className="flex flex-wrap gap-4 justify-center md:justify-start">
            <button 
              onClick={() => onNavigate(AppRoute.TOOL_GENERATOR)}
              className="px-8 py-4 bg-white text-black rounded-full font-bold hover:scale-105 transition-transform shadow-[0_0_30px_rgba(255,255,255,0.2)]"
            >
              Start Creating
            </button>
          </div>
        </div>
      </section>

      {/* Community Feed */}
      <section>
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            Community Feed <span className="text-xs bg-white/10 px-2 py-1 rounded-full text-gray-400 font-normal">LIVE</span>
          </h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {feed.map((asset) => (
            <div key={asset.id} className="glass-panel rounded-2xl overflow-hidden border border-white/10 flex flex-col">
              {/* Image Header */}
              <div className="relative aspect-square bg-black/50 group">
                 <img 
                    src={asset.url} 
                    alt={asset.name} 
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                 />
                 <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent opacity-60"></div>
                 <div className="absolute bottom-4 left-4 right-4">
                    <p className="text-white font-bold text-sm truncate">{asset.prompt || "Untitled Creation"}</p>
                    <p className="text-xs text-gray-400">by User_{asset.ownerId.slice(0,4)}</p>
                 </div>
              </div>

              {/* Actions */}
              <div className="p-4 border-t border-white/5 bg-black/20">
                 <div className="flex items-center justify-between mb-4">
                    <button 
                        onClick={() => handleLike(asset.id)}
                        className={`flex items-center gap-2 text-xs font-bold transition-colors ${
                            user && asset.likes.includes(user.id) ? 'text-red-500' : 'text-gray-400 hover:text-white'
                        }`}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill={user && asset.likes.includes(user.id) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                        {asset.likes.length} Likes
                    </button>
                    <span className="text-xs text-gray-500">{asset.comments.length} Comments</span>
                 </div>

                 {/* Comments Preview */}
                 <div className="space-y-2 mb-4 max-h-24 overflow-y-auto custom-scrollbar">
                    {asset.comments.map(c => (
                        <div key={c.id} className="text-xs">
                            <span className="font-bold text-gray-300">{c.username}:</span> <span className="text-gray-500">{c.text}</span>
                        </div>
                    ))}
                 </div>

                 {/* Add Comment */}
                 <div className="flex gap-2">
                    <input 
                        type="text" 
                        value={commentText[asset.id] || ''}
                        onChange={(e) => setCommentText(prev => ({...prev, [asset.id]: e.target.value}))}
                        placeholder="Leave a thought..."
                        className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:border-white/40 focus:outline-none"
                    />
                    <button 
                        onClick={() => handleComment(asset.id)}
                        disabled={!commentText[asset.id]}
                        className="text-xs font-bold bg-white text-black px-3 rounded-lg hover:bg-gray-200 disabled:opacity-50"
                    >
                        Post
                    </button>
                 </div>
              </div>
            </div>
          ))}

          {feed.length === 0 && (
              <div className="col-span-full py-20 text-center text-gray-500">
                  <p>No public generations yet. Be the first to publish!</p>
              </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default Home;