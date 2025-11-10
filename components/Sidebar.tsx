import React, { useState, useMemo } from 'react';
import { Lecture } from '../types';
import { PlusIcon, UploadIcon, SearchIcon, TagIcon, XIcon, SunIcon, MoonIcon, SettingsIcon } from './icons';

interface SidebarProps {
  lectures: Lecture[];
  activeLectureId: string | null;
  onSelectLecture: (id: string) => void;
  onNewLiveLecture: () => void;
  onUpload: () => void;
  onDeleteLecture: (id: string) => void;
  isMobile: boolean;
  onCloseRequest: () => void;
  onOpenSettings: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ lectures, activeLectureId, onSelectLecture, onNewLiveLecture, onUpload, onDeleteLecture, isMobile, onCloseRequest, onOpenSettings }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    lectures.forEach(lecture => {
      lecture.tags.forEach(tag => tags.add(tag));
    });
    return Array.from(tags).sort();
  }, [lectures]);

  const filteredLectures = useMemo(() => {
    let filtered = lectures;

    if (activeTag) {
      filtered = filtered.filter(lecture => lecture.tags.includes(activeTag));
    }

    if (searchQuery.trim()) {
      const lowercasedQuery = searchQuery.toLowerCase();
      filtered = filtered.filter(lecture =>
        lecture.title.toLowerCase().includes(lowercasedQuery) ||
        lecture.date.toLowerCase().includes(lowercasedQuery) ||
        lecture.tags.some(tag => tag.toLowerCase().includes(lowercasedQuery))
      );
    }
    return filtered;
  }, [lectures, searchQuery, activeTag]);

  return (
    <div className="w-80 bg-gray-100 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 flex flex-col h-screen p-4">
      <div className="flex items-center justify-between mb-6">
         <h1 className="text-2xl font-bold text-gray-900 dark:text-white">IntelliNote</h1>
         {isMobile && (
            <button onClick={onCloseRequest} className="p-1 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full">
                <XIcon className="w-6 h-6" />
            </button>
         )}
      </div>

      <div className="flex flex-col space-y-2 mb-6">
        <button onClick={onNewLiveLecture} className="flex items-center justify-center w-full px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-100 dark:focus:ring-offset-gray-900 focus:ring-indigo-500 transition-all duration-200">
            <PlusIcon className="w-5 h-5 mr-2" />
            New Live Lecture
        </button>
        <button onClick={onUpload} className="flex items-center justify-center w-full px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-100 dark:focus:ring-offset-gray-900 focus:ring-indigo-500 transition-all duration-200">
            <UploadIcon className="w-5 h-5 mr-2" />
            Upload Notes/PDFs
        </button>
      </div>

      <div className="relative mb-4">
        <span className="absolute inset-y-0 left-0 flex items-center pl-3">
            <SearchIcon className="w-5 h-5 text-gray-400 dark:text-gray-500" />
        </span>
        <input
            type="text"
            placeholder="Search by title, date, tag..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm text-gray-800 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
        />
      </div>

      {allTags.length > 0 && (
        <div className="mb-4">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 flex items-center">
                <TagIcon className="w-4 h-4 mr-2" /> Tags
            </h3>
            <div className="flex flex-wrap gap-2">
                <button onClick={() => setActiveTag(null)} className={`px-2 py-1 text-xs rounded-full transition-colors ${!activeTag ? 'bg-indigo-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'}`}>All</button>
                {allTags.map(tag => (
                    <button key={tag} onClick={() => setActiveTag(tag)} className={`px-2 py-1 text-xs rounded-full transition-colors ${activeTag === tag ? 'bg-indigo-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'}`}>
                        {tag}
                    </button>
                ))}
            </div>
        </div>
      )}


      <h2 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">My Lectures</h2>
      <div className="flex-1 overflow-y-auto pr-2">
        <nav className="space-y-1">
          {filteredLectures.length === 0 ? (
            <p className="text-gray-500 text-sm p-2">
              {searchQuery || activeTag ? 'No results found.' : 'No lectures yet.'}
            </p>
          ) : (
            filteredLectures.map((lecture) => (
              <a
                key={lecture.id}
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  onSelectLecture(lecture.id);
                }}
                className={`group relative flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md transition-colors duration-150 ${
                  activeLectureId === lecture.id
                    ? 'bg-indigo-100 dark:bg-indigo-500 dark:bg-opacity-20 text-indigo-600 dark:text-indigo-300'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                <div className="flex flex-col overflow-hidden">
                    <span className="font-semibold truncate">{lecture.title}</span>
                    <span className="text-xs text-gray-500">{lecture.date}</span>
                </div>
                 <button
                    onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onDeleteLecture(lecture.id);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-gray-500 hover:bg-red-500 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity z-10"
                    title="Delete Lecture"
                >
                    <XIcon className="w-4 h-4" />
                </button>
              </a>
            ))
          )}
        </nav>
      </div>
       <div className="mt-auto pt-4 border-t border-gray-200 dark:border-gray-700">
        <button 
          onClick={onOpenSettings}
          className="w-full flex items-center justify-center p-2 rounded-md text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          aria-label="Open AI Settings"
        >
          <SettingsIcon className="w-5 h-5" />
          <span className="ml-2 text-sm">Settings</span>
        </button>
      </div>
    </div>
  );
};

export default Sidebar;