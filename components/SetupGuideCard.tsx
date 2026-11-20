import React from 'react';
import type { SetupGuide } from '../services/setupGuides';
import { openExternal } from '../utils/openExternal';

const COST_STYLE: Record<SetupGuide['cost'], string> = {
  Free: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  'Free tier': 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  'Free credit': 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  Paid: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
};

const SetupGuideCard: React.FC<{ guide: SetupGuide }> = ({ guide }) => (
  <div className="mt-3 rounded-md border border-gray-200 dark:border-gray-700 p-3 text-sm text-gray-700 dark:text-gray-300">
    <div className="flex items-center justify-between gap-2 mb-2">
      <span className="font-semibold">How to set this up</span>
      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${COST_STYLE[guide.cost]}`}>{guide.cost}</span>
    </div>
    {guide.access && <p className="mb-2">{guide.access}</p>}
    <ol className="list-decimal ml-5 space-y-1">
      {guide.steps.map((step, index) => (
        <li key={step}>
          {step}
          {guide.command && guide.commandAfterStep === index + 1 && (
            <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-gray-100 p-2 dark:bg-gray-900"><code>{guide.command}</code></pre>
          )}
        </li>
      ))}
    </ol>
    <button type="button" onClick={() => void openExternal(guide.keyUrl)}
      className="mt-2 text-indigo-600 dark:text-indigo-400 font-medium hover:underline">
      {guide.keyLinkLabel} ↗
    </button>
  </div>
);

export default SetupGuideCard;
