import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Post, User, Comment, ScrollState } from '../types';
import { PostCard } from './PostCard';
import CommentCard from './CommentCard';
import { geminiService } from '../services/geminiService';
import { firebaseService } from '../services/firebaseService';
import Icon from './Icon';
import { getTtsPrompt } from '../constants';
import { useSettings } from '../contexts/SettingsContext';
import { db } from '../services/firebaseConfig'; // <-- db import করুন

interface PostDetailScreenProps {
  postId: string;
  newlyAddedCommentId?: string;
  currentUser: User;
  onSetTtsMessage: (message: string) => void;
  lastCommand: string | null;
  onStartComment: (postId: string, parentId?: string) => void;
  onReactToPost: (postId: string, emoji: string) => void;
  onOpenProfile: (userName: string) => void;
  onSharePost: (post: Post) => void;
  scrollState: ScrollState;
  onCommandProcessed: () => void;
  onGoBack: () => void;
}

const PostDetailScreen: React.FC<PostDetailScreenProps> = ({ postId, newlyAddedCommentId, currentUser, onSetTtsMessage, lastCommand, onStartComment, onReactToPost, onOpenProfile, onSharePost, scrollState, onCommandProcessed, onGoBack }) => {
  const [post, setPost] = useState<Post | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [playingCommentId, setPlayingCommentId] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const newCommentRef = useRef<HTMLDivElement>(null);
  const { language } = useSettings();

  // --- সমাধান: Polling এর পরিবর্তে onSnapshot ব্যবহার ---
  useEffect(() => {
    setIsLoading(true);
    const postRef = db.collection('posts').doc(postId);
    
    const unsubscribe = postRef.onSnapshot(
      (doc) => {
        if (doc.exists) {
          const fetchedPost = docToPost(doc); // Using the helper to format data
          setPost(fetchedPost);
          if (isLoading) { // Only show TTS on initial load
             onSetTtsMessage(getTtsPrompt('post_details_loaded', language));
          }
        } else {
          setPost(null);
          onSetTtsMessage("This post could not be found. It may have been deleted.");
        }
        setIsLoading(false);
      },
      (error) => {
        console.error("Error listening to post details:", error);
        setIsLoading(false);
        onSetTtsMessage("Failed to load post details.");
      }
    );

    // Highlight new comment if any
    if (newlyAddedCommentId) {
        setTimeout(() => {
            newCommentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 500);
    }

    return () => unsubscribe(); // Cleanup the listener on component unmount
  }, [postId, newlyAddedCommentId, onSetTtsMessage, language]);
  
  
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer || scrollState === 'none') {
        return;
    }

    let animationFrameId: number;
    const animateScroll = () => {
        if (scrollState === 'down') {
            scrollContainer.scrollTop += 2;
        } else if (scrollState === 'up') {
            scrollContainer.scrollTop -= 2;
        }
        animationFrameId = requestAnimationFrame(animateScroll);
    };
    
    animationFrameId = requestAnimationFrame(animateScroll);

    return () => {
        cancelAnimationFrame(animationFrameId);
    };
  }, [scrollState]);
  
  const handlePlayComment = useCallback((comment: Comment) => {
    if (comment.type !== 'audio') return;

    if (playingCommentId === comment.id) {
        setPlayingCommentId(null);
    } else {
        setPlayingCommentId(comment.id);
    }
  }, [playingCommentId]);

  // --- সমাধান: handleReactToComment এখন আর ডেটা fetch করে না ---
  const handleReactToComment = async (commentId: string, emoji: string) => {
    if (!post || !currentUser) return;
    // Just update the database. The onSnapshot listener will handle the UI update.
    await firebaseService.reactToComment(post.id, commentId, currentUser.id, emoji);
  };

  const handleReply = (comment: Comment) => {
    if (!post) return;
    onStartComment(post.id, comment.id);
  };
  
  const handleMarkBestAnswer = async (commentId: string) => {
    if (!post) return;
    // The listener will update the UI automatically after this.
    await geminiService.markBestAnswer(currentUser.id, post.id, commentId);
    onSetTtsMessage("Best answer marked!");
  };

  const handleCommand = useCallback(async (command: string) => {
    try {
        const intentResponse = await geminiService.processIntent(command);
        if (!post) return;

        switch (intentResponse.intent) {
            case 'intent_go_back':
                onGoBack();
                break;
            case 'intent_like':
                onReactToPost(post.id, '👍');
                break;
            case 'intent_share':
                if (post) {
                    onSharePost(post);
                }
                break;
            case 'intent_comment':
                onStartComment(post.id);
                break;
            case 'intent_play_comment_by_author':
                if (intentResponse.slots?.target_name) {
                    const targetName = (intentResponse.slots.target_name as string).toLowerCase();
                    const commentToPlay = post.comments.find(c => 
                        c.author.name.toLowerCase().includes(targetName) && c.type === 'audio'
                    );
                    
                    if (commentToPlay) {
                        handlePlayComment(commentToPlay);
                        onSetTtsMessage(`Playing comment from ${commentToPlay.author.name}.`);
                    } else {
                        onSetTtsMessage(`Sorry, I couldn't find an audio comment from ${targetName} on this post.`);
                    }
                }
                break;
        }
    } catch (error) {
        console.error("Error processing command in PostDetailScreen:", error);
    } finally {
        onCommandProcessed();
    }
  }, [post, onReactToPost, onStartComment, handlePlayComment, onSetTtsMessage, onCommandProcessed, onGoBack, onSharePost]);

  useEffect(() => {
    if (lastCommand) {
      handleCommand(lastCommand);
    }
  }, [lastCommand, handleCommand]);

  const renderCommentTree = (allComments: Comment[], parentId?: string): React.ReactNode[] => {
    return allComments
      .filter(comment => comment.parentId === parentId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map(comment => {
        const isBestAnswer = post?.bestAnswerId === comment.id;
        const canMarkBest = post?.postType === 'question' && post?.author.id === currentUser.id;
        const isNew = comment.id === newlyAddedCommentId;
        const replies = renderCommentTree(allComments, comment.id);

        return (
            <div key={comment.id}>
                <div ref={isNew ? newCommentRef : null} className={`p-0.5 rounded-lg transition-all duration-500 ${isBestAnswer ? 'bg-gradient-to-br from-emerald-500 to-green-500' : ''} ${isNew ? 'ring-2 ring-rose-500' : ''}`}>
                    <div className={`${isBestAnswer ? 'bg-slate-800 rounded-md' : ''}`}>
                        <CommentCard
                            comment={comment}
                            currentUser={currentUser}
                            isPlaying={playingCommentId === comment.id}
                            onPlayPause={() => handlePlayComment(comment)}
                            onAuthorClick={onOpenProfile}
                            onReact={handleReactToComment}
                            onReply={handleReply}
                        />
                        {canMarkBest && !isBestAnswer && (
                            <button onClick={() => handleMarkBestAnswer(comment.id)} className="mt-2 ml-14 text-xs font-semibold text-emerald-400 hover:underline">
                                Mark as best answer
                            </button>
                        )}
                    </div>
                </div>
                {replies.length > 0 && (
                    <div className="ml-5 mt-2 pl-4 border-l-2 border-slate-600 flex flex-col gap-3">
                        {replies}
                    </div>
                )}
            </div>
        );
      });
  };


  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><p className="text-slate-300 text-xl">Loading post...</p></div>;
  }

  if (!post) {
    return <div className="flex items-center justify-center h-full"><p className="text-slate-300 text-xl">Post not found.</p></div>;
  }

  return (
    <div ref={scrollContainerRef} className="h-full w-full overflow-y-auto">
      <div className="max-w-lg mx-auto p-4 sm:p-8 flex flex-col gap-6">
        <PostCard
          post={post}
          currentUser={currentUser}
          isActive={true}
          isPlaying={false} // Main post doesn't auto-play here
          onPlayPause={() => {}} // Could be implemented if desired
          onReact={onReactToPost}
          onViewPost={() => {}} // Already on the view
          onAuthorClick={onOpenProfile}
          onStartComment={(postId) => onStartComment(postId)}
          onSharePost={onSharePost}
        />

        <div className="bg-slate-800/50 rounded-xl p-4">
             <h3 className="text-lg font-bold text-slate-200 mb-3">Comments ({post.commentCount})</h3>
             <button onClick={() => onStartComment(post.id)} className="w-full flex items-center justify-center gap-3 bg-rose-600 hover:bg-rose-500 text-white font-bold py-3 px-4 rounded-lg transition-colors mb-4">
                <Icon name="add-circle" className="w-6 h-6" />
                <span>Add a Comment</span>
             </button>
             <div className="flex flex-col gap-3">
                {post.comments.length > 0 ? renderCommentTree(post.comments) : (
                    <p className="text-slate-400 text-center py-4">Be the first to comment.</p>
                )}
             </div>
        </div>
      </div>
    </div>
  );
};

// Helper function to format post data
const docToPost = (doc: any): Post => {
    const data = doc.data() || {};
    return {
        ...data,
        id: doc.id,
        createdAt: data.createdAt instanceof firebase.firestore.Timestamp ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
        reactions: data.reactions || {},
        comments: data.comments || [],
        commentCount: data.commentCount || 0,
    } as Post;
}


export default PostDetailScreen;
