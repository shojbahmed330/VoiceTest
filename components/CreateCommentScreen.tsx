
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { RecordingState, User, Comment } from '../types';
import Waveform from './Waveform';
import { firebaseService } from '../services/firebaseService';
import { geminiService } from '../services/geminiService';
import { getTtsPrompt } from '../constants';
import Icon from './Icon';
import { useSettings } from '../contexts/SettingsContext';

interface CreateCommentScreenProps {
  user: User;
  postId: string;
  onCommentPosted: (newComment: Comment | null, postId: string) => void;
  onSetTtsMessage: (message: string) => void;
  lastCommand: string | null;
  onCommandProcessed: () => void;
  onGoBack: () => void;
}

type CommentMode = 'audio' | 'text' | 'image';

const CreateCommentScreen: React.FC<CreateCommentScreenProps> = ({ user, postId, onCommentPosted, onSetTtsMessage, lastCommand, onCommandProcessed, onGoBack }) => {
  const [mode, setMode] = useState<CommentMode>('audio');
  
  // Audio state
  const [recordingState, setRecordingState] = useState<RecordingState>(RecordingState.IDLE);
  const [duration, setDuration] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Text state
  const [text, setText] = useState('');

  // Image state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // General state
  const [isPosting, setIsPosting] = useState(false);
  const { language } = useSettings();

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    setDuration(0);
    timerRef.current = setInterval(() => {
      setDuration(d => d + 1);
    }, 1000);
  }, [stopTimer]);
  
  const startRecording = useCallback(async () => {
    if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
        setAudioUrl(null);
    }
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;
        audioChunksRef.current = [];
        recorder.ondataavailable = (event) => audioChunksRef.current.push(event.data);
        recorder.onstop = () => {
            const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            const newAudioUrl = URL.createObjectURL(audioBlob);
            setAudioUrl(newAudioUrl);
            stream.getTracks().forEach(track => track.stop());
            onSetTtsMessage(getTtsPrompt('comment_stopped', language, { duration }));
        };
        recorder.start();
        setRecordingState(RecordingState.RECORDING);
        onSetTtsMessage(getTtsPrompt('comment_record_start', language));
        startTimer();
    } catch (err: any) {
        console.error("Mic permission error:", err);
        if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            onSetTtsMessage(getTtsPrompt('error_mic_not_found', language));
        } else {
            onSetTtsMessage(getTtsPrompt('error_mic_permission', language));
        }
        onGoBack(); // Go back if mic fails, as it's the primary action
    }
  }, [audioUrl, onSetTtsMessage, startTimer, duration, onGoBack, language]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
        stopTimer();
        setRecordingState(RecordingState.PREVIEW);
    }
  }, [stopTimer]);
  
  useEffect(() => {
    if(mode === 'audio' && recordingState === RecordingState.IDLE) {
        startRecording();
    }
    return () => {
        stopTimer();
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        if (imagePreview) URL.revokeObjectURL(imagePreview);
        mediaRecorderRef.current?.stream?.getTracks().forEach(track => track.stop());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const handlePost = useCallback(async () => {
    setIsPosting(true);
    let newComment: Comment | null = null;
    try {
        if (mode === 'text' && text.trim()) {
            onSetTtsMessage('Posting text comment...');
            newComment = await firebaseService.createComment(user, postId, { text });
        } else if (mode === 'image' && imagePreview) {
            onSetTtsMessage('Uploading image comment...');
            newComment = await firebaseService.createComment(user, postId, { imageUrl: imagePreview });
        } else if (mode === 'audio' && duration > 0 && audioUrl) {
            onSetTtsMessage('Posting voice comment...');
            setRecordingState(RecordingState.UPLOADING);
            newComment = await firebaseService.createComment(user, postId, { duration, audioUrl });
        } else {
             onSetTtsMessage('Please add content to your comment.');
             setIsPosting(false);
             return;
        }

        onCommentPosted(newComment, postId);

    } catch (error) {
        console.error("Failed to post comment:", error);
        onSetTtsMessage("Sorry, there was an error posting your comment.");
        setIsPosting(false);
    }
  }, [user, postId, onCommentPosted, onSetTtsMessage, mode, text, imagePreview, duration, audioUrl]);

  const handleCommand = useCallback(async (command: string) => {
    try {
        const intentResponse = await geminiService.processIntent(command);
        const lowerCommand = command.toLowerCase();

        if (intentResponse.intent === 'intent_go_back') {
            onGoBack();
        } else if (mode === 'audio') {
            if (recordingState === RecordingState.RECORDING && (intentResponse.intent === 'intent_stop_recording' || lowerCommand === 'stop')) {
                stopRecording();
            } else if (recordingState === RecordingState.PREVIEW) {
                if (intentResponse.intent === 'intent_post_comment' || lowerCommand.includes('post')) {
                    handlePost();
                } else if (intentResponse.intent === 'intent_re_record') {
                    startRecording();
                }
            }
        } else if ((mode === 'text' || mode === 'image') && intentResponse.intent === 'intent_post_comment') {
            handlePost();
        }
    } catch (error) {
        console.error("Error processing command in CreateCommentScreen:", error);
    } finally {
        onCommandProcessed();
    }
  }, [mode, recordingState, stopRecording, handlePost, startRecording, onCommandProcessed, onGoBack]);

  useEffect(() => {
    if (lastCommand) {
      handleCommand(lastCommand);
    }
  }, [lastCommand, handleCommand]);
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      if(imagePreview) URL.revokeObjectURL(imagePreview);
      setImagePreview(URL.createObjectURL(file));
    }
  };
  
  const TabButton: React.FC<{ label: string; iconName: React.ComponentProps<typeof Icon>['name']; targetMode: CommentMode }> = ({ label, iconName, targetMode }) => (
      <button 
          onClick={() => setMode(targetMode)}
          className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-t-lg transition-colors ${mode === targetMode ? 'bg-slate-800 text-rose-400' : 'bg-slate-700/50 text-slate-300 hover:bg-slate-700'}`}
      >
          <Icon name={iconName} className="w-5 h-5" />
          <span className="font-semibold">{label}</span>
      </button>
  );

  const renderContent = () => {
    switch (mode) {
      case 'text':
        return (
          <div className="w-full bg-slate-700 rounded-b-lg p-4 flex flex-col items-center justify-center">
            <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="Write your comment..."
                rows={5}
                className="w-full bg-slate-800 border-slate-600 rounded-lg p-4 focus:ring-rose-500 focus:border-rose-500 text-lg resize-none"
                autoFocus
            />
             <button className="mt-2 mr-auto px-3 py-1.5 text-sm bg-slate-600 hover:bg-slate-500 rounded-full">Add Emoji (Not Implemented)</button>
          </div>
        );
      case 'image':
        return (
          <div className="w-full bg-slate-700 rounded-b-lg p-4 flex flex-col items-center justify-center h-48">
            <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
            {imagePreview ? (
              <div className="relative group">
                <img src={imagePreview} alt="Preview" className="max-h-36 rounded-md"/>
                <button onClick={() => fileInputRef.current?.click()} className="absolute inset-0 bg-black/50 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity">
                    Change
                </button>
              </div>
            ) : (
              <button onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center gap-2 text-slate-400 hover:text-white">
                <Icon name="photo" className="w-12 h-12"/>
                <span>Upload an Image</span>
              </button>
            )}
          </div>
        );
      case 'audio':
      default:
        return (
            <div className="w-full bg-slate-700 rounded-b-lg p-4 flex flex-col items-center justify-center h-48">
                {recordingState === RecordingState.PREVIEW && audioUrl ? (
                    <div className="text-center w-full">
                        <p className="text-lg">Preview your {duration}s comment</p>
                        <audio src={audioUrl} controls className="w-full my-2" />
                        <p className="text-sm text-slate-400">Say "post comment" or "re-record"</p>
                    </div>
                ) : recordingState === RecordingState.RECORDING ? (
                    <>
                        <div className="w-full h-24">
                            <Waveform isPlaying={false} isRecording={true}/>
                        </div>
                        <p className="text-2xl font-mono mt-2">00:{duration.toString().padStart(2, '0')}</p>
                    </>
                ) : (
                    <p className="text-lg text-slate-400">Initializing microphone...</p>
                )}
            </div>
        );
    }
  };

  const canPost = (mode === 'audio' && recordingState === RecordingState.PREVIEW) || (mode === 'text' && text.trim()) || (mode === 'image' && imagePreview);

  return (
    <div className="flex flex-col items-center justify-center h-full text-center text-slate-100 p-4 sm:p-8">
      <div className="w-full max-w-lg">
        <div className="flex">
            <TabButton label="Voice" iconName="mic" targetMode="audio" />
            <TabButton label="Text" iconName="edit" targetMode="text" />
            <TabButton label="Image" iconName="photo" targetMode="image" />
        </div>
        {renderContent()}
        <button 
            onClick={handlePost}
            disabled={!canPost || isPosting}
            className="w-full mt-6 bg-rose-600 hover:bg-rose-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg transition-colors text-lg"
        >
            {isPosting ? "Posting..." : "Post Comment"}
        </button>
      </div>
    </div>
  );
};

export default CreateCommentScreen;
