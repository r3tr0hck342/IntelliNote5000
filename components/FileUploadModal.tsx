import React, { useState, useCallback } from 'react';
import { Handout, StudySession } from '../types';
import { UploadIcon, FileTextIcon, XIcon } from './icons';
import { parseFile } from '../utils/fileParser';


interface FileUploadModalProps {
  onClose: () => void;
  onCreateLecture: (data: { title: string; transcript: string; handouts: Handout[]; sessionId?: string }) => void;
  sessions: StudySession[];
}

const FileUploadModal: React.FC<FileUploadModalProps> = ({ onClose, onCreateLecture, sessions }) => {
  const [title, setTitle] = useState('');
  const [transcript, setTranscript] = useState('');
  const [handouts, setHandouts] = useState<Handout[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string>('new');

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsParsing(true);
    const newHandouts: Handout[] = [];
    for (const file of Array.from(files)) {
      try {
        const handout = await parseFile(file);
        if (handout) {
          newHandouts.push(handout);
        }
      } catch (error) {
        alert(`Failed to parse ${file.name}. Please ensure it's a valid and non-corrupted file.`);
      }
    }
    setHandouts(prev => [...prev, ...newHandouts]);
    setIsParsing(false);
  }, []);

  const handleDragEvents = (e: React.DragEvent<HTMLDivElement>, isOver: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(isOver);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    handleDragEvents(e, false);
    handleFiles(e.dataTransfer.files);
  };

  const handleCreate = () => {
    if (!transcript.trim()) {
      alert('A transcript is required to use the AI features.');
      return;
    }
    onCreateLecture({ title, transcript, handouts, sessionId: selectedSessionId === 'new' ? undefined : selectedSessionId });
  };
  
  const removeHandout = (index: number) => {
      setHandouts(prev => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Import Transcript or Handouts</h2>
          <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">
            <XIcon className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto">
          <div className="space-y-3">
            <div>
              <label htmlFor="session-select" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Save to Session</label>
              <select
                id="session-select"
                value={selectedSessionId}
                onChange={(e) => setSelectedSessionId(e.target.value)}
                className="w-full bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md p-2 text-gray-800 dark:text-gray-200 focus:ring-indigo-500 focus:border-indigo-500"
              >
                <option value="new">Create new session</option>
                {sessions.map(session => (
                  <option key={session.id} value={session.id}>{session.title}</option>
                ))}
              </select>
            </div>
            {selectedSessionId === 'new' && (
              <div>
                <label htmlFor="title" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Session Title</label>
                <input
                  id="title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Introduction to Quantum Physics"
                  className="w-full bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md p-2 text-gray-800 dark:text-gray-200 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
            )}
          </div>

          <div>
            <label htmlFor="transcript" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Transcript Text <span className="text-red-500 dark:text-red-400">*</span>
            </label>
            <textarea
              id="transcript"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              rows={8}
              placeholder="Paste the full transcript here. This is required for all AI features."
              className="w-full bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-md p-2 text-gray-800 dark:text-gray-200 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Attach Handouts (PDF, DOCX, TXT, MD)</label>
            <div
              onDragEnter={(e) => handleDragEvents(e, true)}
              onDragLeave={(e) => handleDragEvents(e, false)}
              onDragOver={(e) => handleDragEvents(e, true)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-md p-6 text-center transition-colors ${
                dragOver ? 'border-indigo-500 bg-gray-100 dark:bg-gray-700' : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
              }`}
            >
              <UploadIcon className="w-10 h-10 mx-auto text-gray-500 mb-2" />
              <p className="text-gray-600 dark:text-gray-400">Drag & drop files here, or</p>
              <label htmlFor="file-upload" className="cursor-pointer text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 font-medium">
                browse to upload
                <input id="file-upload" type="file" multiple className="sr-only" onChange={(e) => handleFiles(e.target.files)} accept=".pdf,.docx,.txt,.md,.text" />
              </label>
            </div>
          </div>
          
          {isParsing && <p className="text-center text-gray-500 dark:text-gray-400 animate-pulse">Parsing files...</p>}

          {handouts.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Attached Files:</h3>
              <ul className="space-y-2">
                {handouts.map((handout, index) => (
                  <li key={index} className="bg-gray-100 dark:bg-gray-700 rounded-md p-2 flex items-center justify-between text-sm">
                    <div className="flex items-center overflow-hidden">
                      <FileTextIcon className="w-5 h-5 mr-2 text-gray-500 dark:text-gray-400 flex-shrink-0" />
                      <span className="text-gray-800 dark:text-gray-200 truncate">{handout.name}</span>
                    </div>
                     <button onClick={() => removeHandout(index)} className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-white flex-shrink-0">
                        <XIcon className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end space-x-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={isParsing || !transcript.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:bg-indigo-400 disabled:cursor-not-allowed"
          >
            Import Transcript
          </button>
        </div>
      </div>
    </div>
  );
};

export default FileUploadModal;
