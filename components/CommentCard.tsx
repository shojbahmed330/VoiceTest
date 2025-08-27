import React, { useRef, useEffect, useState, useMemo } from 'react';
import type { Comment, User } from '../types';
import Icon from './Icon';
import Waveform from './Waveform';
import TaggedContent from './TaggedContent';

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '😡'];
const REACTION_COLORS: { [key: string]: string } = {
    '👍': 'text-lime-500',
    '❤️': 'text-red-500',
    '😂': 'text-yellow-500',
    '😮': 'text-yellow-500',
    '😢': 'text-yellow-500',
    '😡': 'text-orange-500',
};

interface CommentCardProps {
  comment: Comment;
  currentUser?: User;
  isPlaying: boolean;
  onPlayPause: () => void;
  onAuthorClick: (username: string) => void;
  onReact: (commentId: string, emoji: string) => void;
  onReply: (comment: Comment) => void;
}

const CommentCard: React.FC<CommentCardProps> = ({ comment, currentUser, isPlaying, onPlayPause, onAuthorClick, onReact, onReply }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPickerOpen, setPickerOpen] = useState(false);
  const pickerTimeout = useRef<number | null>(null);

  const timeAgo = new Date(comment.createdAt).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });

  const myReaction = useMemo(() => {
    if (!currentUser || !comment.reactions) return null;
    return comment.reactions[currentUser.id] || null;
  }, [currentUser, comment.reactions]);

  const topReactions = useMemo(() => {
    if (!comment.reactions) return [];
    const emojiCounts: { [emoji: string]: number } = {};
    for (const userId in comment.reactions) {
        const emoji = comment.reactions[userId];
        emojiCounts[emoji] = (emojiCounts[emoji] || 0) + 1;
    }
    return Object.entries(emojiCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(entry => entry[0]);
  }, [comment.reactions]);

  const reactionCount = useMemo(() => {
    if (!comment.reactions) return 0;
    return Object.keys(comment.reactions).length;
  }, [comment.reactions]);

  useEffect(() => {
    const audioElement = audioRef.current;
    if (audioElement) {
        if (isPlaying) {
            audioElement.play().catch(e => console.error("Comment audio playback error:", e));
        } else {
            audioElement.pause();
        }
    }
  }, [isPlaying]);

  useEffect(() => {
    const audioElement = audioRef.current;
    if (audioElement) {
        const handleEnded = () => {
            if (!audioElement.paused) {
                onPlayPause();
            }
        };
        audioElement.addEventListener('ended', handleEnded);
        return () => {
            audioElement.removeEventListener('ended', handleEnded);
        }
    }
  }, [onPlayPause]);

  const handleReaction = (e: React.MouseEvent, emoji: string) => {
      e.stopPropagation();
      onReact(comment.id, emoji);
      setPickerOpen(false);
  }

  const handleDefaultReact = (e: React.MouseEvent) => {
    e.stopPropagation();
    onReact(comment.id, myReaction === '👍' ? '👍' : '👍');
  };

  const handleMouseEnter = () => {
    if (pickerTimeout.current) clearTimeout(pickerTimeout.current);
    setPickerOpen(true);
  };

  const handleMouseLeave = () => {
    pickerTimeout.current = window.setTimeout(() => {
        setPickerOpen(false);
    }, 300);
  };

  const renderContent = () => {
    switch(comment.type) {
        case 'text':
            return <p className="text-slate-200 mt-1 whitespace-pre-wrap"><TaggedContent text={comment.text || ''} onTagClick={onAuthorClick} /></p>;
        case 'image':
            return <img src={comment.imageUrl} alt="Comment image" className="mt-2 rounded-lg max-w-full h-auto max-h-60" />;
        case 'audio':
        default:
            return (
                <>
                    {comment.audioUrl && <audio ref={audioRef} src={comment.audioUrl} className="hidden" />}
                    <button
                        onClick={onPlayPause}
                        aria-label={isPlaying ? 'Pause comment' : 'Play comment'}
                        className={`w-full h-12 mt-1 p-2 rounded-md flex items-center gap-3 text-white transition-colors ${isPlaying ? 'bg-sky-500/30' : 'bg-slate-600/50 hover:bg-slate-600'}`}
                    >
                        <Icon name={isPlaying ? 'pause' : 'play'} className="w-5 h-5 flex-shrink-0" />
                        <div className="h-full flex-grow">
                            <Waveform isPlaying={isPlaying} barCount={25} />
                        </div>
                        <span className="text-xs font-mono self-end pb-1">{comment.duration}s</span>
                    </button>
                </>
            );
    }
  };

  return (
    <div className="bg-slate-700/50 rounded-lg p-3 flex gap-3 items-start">
        <button onClick={() => onAuthorClick(comment.author.username)} className="flex-shrink-0 group">
            <img src={comment.author.avatarUrl} alt={comment.author.name} className="w-10 h-10 rounded-full transition-all group-hover:ring-2 group-hover:ring-sky-400" />
        </button>
        <div className="flex-grow">
            <div className="flex items-baseline gap-2">
                <button onClick={() => onAuthorClick(comment.author.username)} className="font-bold text-slate-200 hover:text-sky-300 transition-colors">{comment.author.name}</button>
                <span className="text-xs text-slate-400">{timeAgo}</span>
            </div>
            {renderContent()}
            <div className="mt-2 flex items-center gap-4 text-xs font-semibold text-slate-400">
                <div
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                    className="relative"
                >
                    {isPickerOpen && (
                        <div
                            onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}
                            className="absolute bottom-full mb-2 bg-slate-900/90 backdrop-blur-sm border border-lime-500/20 rounded-full p-1 flex items-center gap-0.5 shadow-lg animate-fade-in-fast"
                        >
                            {REACTIONS.map(emoji => (
                                <button key={emoji} onClick={(e) => handleReaction(e, emoji)} className="text-2xl p-1 rounded-full hover:bg-slate-700/50 transition-transform hover:scale-125">
                                    {emoji}
                                </button>
                            ))}
                        </div>
                    )}
                    <button onClick={handleDefaultReact} className={`hover:underline ${myReaction ? REACTION_COLORS[myReaction] : ''}`}>
                        {myReaction ? 'Reacted' : 'React'}
                    </button>
                </div>
                <button onClick={() => onReply(comment)} className="hover:underline">Reply</button>
                {reactionCount > 0 && (
                    <div className="flex items-center gap-1">
                        {topReactions.map(emoji => <span key={emoji}>{emoji}</span>)}
                        <span className="text-slate-500">{reactionCount}</span>
                    </div>
                )}
            </div>
        </div>
    </div>
  );
};

export default CommentCard;
