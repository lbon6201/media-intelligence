import React, { useState, useEffect, useCallback, useContext } from 'react';
import { api } from '../api';
import { formatDate } from '../lib/helpers';
import { AppContext } from '../App';

export default function QueueTab({ workstream }) {
  const { classifyingWs, setClassifyingWs, classifyProgress, setClassifyProgress } = useContext(AppContext);
  const [articles, setArticles] = useState([]);

  const classifying = classifyingWs === workstream.id;
  const progress = classifying ? classifyProgress : null;

  const loadArticles = useCallback(async () => {
    try {
      const data = await api.getArticles({
        workstream_id: workstream.id,
        status: 'pending',
        sort_by: 'ingested_at',
        sort_dir: 'DESC',
      });
      setArticles(data);
    } catch (e) {
      console.error(e);
    }
  }, [workstream.id]);

  useEffect(() => { loadArticles(); }, [loadArticles]);

  useEffect(() => {
    if (classifyProgress && !classifyProgress.running && !classifyingWs) {
      loadArticles();
    }
  }, [classifyingWs, classifyProgress, loadArticles]);

  async function handleClassify() {
    setClassifyingWs(workstream.id);
    setClassifyProgress(null);
    try { await api.startClassification(workstream.id); }
    catch (e) { alert(e.message); setClassifyingWs(null); }
  }

  async function handleDeleteOne(id) {
    if (!confirm('Delete this article?')) return;
    await api.deleteArticle(id);
    loadArticles();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>Classification Queue</h2>
        {articles.length > 0 && (
          <button onClick={handleClassify} disabled={classifying} className="bg-[#0057b8] text-white px-4 py-2 rounded text-sm hover:bg-[#002855] disabled:opacity-50">
            {classifying ? (progress ? `Classifying... (${progress.done}/${progress.total})` : 'Classifying...') : `Classify ${articles.length} Pending`}
          </button>
        )}
      </div>

      {/* Progress */}
      {classifying && progress && (
        <div className="rounded-lg p-3" style={{ background: '#eff6ff', border: '1px solid #b8cce0' }}>
          <div className="flex justify-between text-sm mb-1" style={{ color: '#0057b8' }}>
            <span>Classifying articles...</span>
            <span>{progress.done} / {progress.total}{progress.failed > 0 && ` (${progress.failed} failed)`}</span>
          </div>
          <div className="w-full rounded-full h-2" style={{ background: '#bfdbfe' }}>
            <div className="rounded-full h-2 transition-all" style={{ background: '#0057b8', width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
        </div>
      )}

      {articles.length === 0 && !classifying ? (
        <div className="text-center py-16" style={{ color: 'var(--text-muted)' }}>
          <p className="text-base mb-2">No pending articles</p>
          <p className="text-sm">Ingest articles to add them to the classification queue.</p>
        </div>
      ) : (
        <div className="bg-white border rounded-lg overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-sm">
            <thead className="border-b" style={{ background: 'var(--bg-content)', borderColor: 'var(--border)' }}>
              <tr>
                <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Headline</th>
                <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Author</th>
                <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Outlet</th>
                <th className="px-3 py-2 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Date</th>
                <th className="w-20 px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ '--tw-divide-opacity': '0.3' }}>
              {articles.map(a => (
                <tr key={a.id} className="hover:bg-[#f0f5fb]/50">
                  <td className="px-3 py-2 font-medium max-w-xs truncate" style={{ color: 'var(--text-primary)' }}>{a.headline}</td>
                  <td className="px-3 py-2 max-w-[120px] truncate" style={{ color: 'var(--text-muted)' }}>{a.author || '—'}</td>
                  <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>{a.outlet || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{formatDate(a.publish_date)}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => handleDeleteOne(a.id)} className="text-slate-400 hover:text-red-500 text-xs">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
