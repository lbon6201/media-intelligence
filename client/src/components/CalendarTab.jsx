import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { sentimentDot, formatDate } from '../lib/helpers';

export default function CalendarTab({ workstream }) {
  const [days, setDays] = useState([]);
  const [events, setEvents] = useState([]);
  const [selectedDay, setSelectedDay] = useState(null);
  const [addingEvent, setAddingEvent] = useState(false);
  const [eventForm, setEventForm] = useState({ date: '', title: '', type: '', notes: '' });
  const [view, setView] = useState('month'); // month | week
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const load = useCallback(async () => {
    const [d, e] = await Promise.all([
      api.getCalendarData(workstream.id),
      api.getEvents(workstream.id),
    ]);
    setDays(d);
    setEvents(e);
  }, [workstream.id]);

  useEffect(() => { load(); }, [load]);

  const dayMap = {};
  days.forEach(d => { dayMap[d.date] = d; });
  const eventMap = {};
  events.forEach(e => { if (!eventMap[e.date]) eventMap[e.date] = []; eventMap[e.date].push(e); });

  // Generate calendar grid for current month
  const now = new Date();
  const year = currentMonth.year;
  const month = currentMonth.month;
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthName = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  function goToPrevMonth() {
    setCurrentMonth(prev => prev.month === 0 ? { year: prev.year - 1, month: 11 } : { year: prev.year, month: prev.month - 1 });
  }

  function goToNextMonth() {
    setCurrentMonth(prev => prev.month === 11 ? { year: prev.year + 1, month: 0 } : { year: prev.year, month: prev.month + 1 });
  }

  function goToToday() {
    const today = new Date();
    setCurrentMonth({ year: today.getFullYear(), month: today.getMonth() });
  }

  const calendarDays = [];
  for (let i = 0; i < firstDay; i++) calendarDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) calendarDays.push(d);

  function dateStr(day) {
    if (!day) return '';
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  async function addEvent() {
    if (!eventForm.date || !eventForm.title) return;
    await api.addEvent(workstream.id, eventForm);
    setEventForm({ date: '', title: '', type: '', notes: '' });
    setAddingEvent(false);
    load();
  }

  async function removeEvent(id) {
    await api.deleteEvent(workstream.id, id);
    load();
  }

  const selectedDayData = selectedDay ? dayMap[selectedDay] : null;
  const selectedDayEvents = selectedDay ? (eventMap[selectedDay] || []) : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={goToPrevMonth} className="px-2 py-1 rounded text-sm hover:bg-gray-100" style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>&larr;</button>
          <h2 className="text-base font-semibold min-w-[180px] text-center" style={{ color: 'var(--text-primary)' }}>{monthName}</h2>
          <button onClick={goToNextMonth} className="px-2 py-1 rounded text-sm hover:bg-gray-100" style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>&rarr;</button>
          <button onClick={goToToday} className="px-2 py-1 rounded text-xs hover:bg-gray-100" style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}>Today</button>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setAddingEvent(!addingEvent)} className="btn-primary px-3 py-1.5 text-xs">Add Event</button>
        </div>
      </div>

      {addingEvent && (
        <div className="card p-4 flex gap-3 items-end">
          <div><label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Date</label><input type="date" className="block w-full mt-1 rounded px-2 py-1.5 text-xs" style={{ border: '1px solid var(--border)' }} value={eventForm.date} onChange={e => setEventForm({ ...eventForm, date: e.target.value })} /></div>
          <div className="flex-1"><label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Title</label><input className="block w-full mt-1 rounded px-2 py-1.5 text-xs" style={{ border: '1px solid var(--border)' }} value={eventForm.title} onChange={e => setEventForm({ ...eventForm, title: e.target.value })} /></div>
          <div><label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Type</label><input className="block w-full mt-1 rounded px-2 py-1.5 text-xs" style={{ border: '1px solid var(--border)' }} placeholder="e.g. Earnings, Hearing" value={eventForm.type} onChange={e => setEventForm({ ...eventForm, type: e.target.value })} /></div>
          <button onClick={addEvent} className="btn-primary px-3 py-1.5 text-xs">Save</button>
        </div>
      )}

      {/* Calendar grid */}
      <div className="card overflow-hidden">
        <div className="grid grid-cols-7">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className="text-center py-2 text-xs font-medium" style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>{d}</div>
          ))}
          {calendarDays.map((day, i) => {
            if (!day) return <div key={`empty-${i}`} style={{ borderBottom: '1px solid var(--border-subtle)', borderRight: '1px solid var(--border-subtle)' }} />;
            const ds = dateStr(day);
            const data = dayMap[ds];
            const dayEvents = eventMap[ds];
            const isSelected = selectedDay === ds;
            const isToday = day === now.getDate() && month === now.getMonth() && year === now.getFullYear();

            return (
              <div key={day} onClick={() => setSelectedDay(ds)} className="min-h-[80px] p-1.5 cursor-pointer transition-colors" style={{
                borderBottom: '1px solid var(--border-subtle)', borderRight: '1px solid var(--border-subtle)',
                background: isSelected ? 'var(--bg-selected)' : data ? `${sentimentDot(Math.round(data.avg_sentiment))}10` : 'transparent',
              }}>
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-mono ${isToday ? 'font-bold' : ''}`} style={{ color: isToday ? 'var(--accent)' : 'var(--text-secondary)' }}>{day}</span>
                  {data && <span className="text-xs font-mono font-bold" style={{ color: sentimentDot(Math.round(data.avg_sentiment)) }}>{data.count}</span>}
                </div>
                {data && (
                  <div className="mt-1 w-full h-1.5 rounded-full" style={{ background: sentimentDot(Math.round(data.avg_sentiment)) + '40' }}>
                    <div className="h-full rounded-full" style={{ background: sentimentDot(Math.round(data.avg_sentiment)), width: `${Math.min(data.count * 20, 100)}%` }} />
                  </div>
                )}
                {dayEvents?.map(e => (
                  <div key={e.id} className="mt-1 text-[10px] px-1 rounded truncate" style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}>{e.title}</div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected day detail */}
      {selectedDay && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>{formatDate(selectedDay)} — {selectedDayData?.count || 0} articles</h3>
          {selectedDayEvents.length > 0 && (
            <div className="mb-3 space-y-1">
              {selectedDayEvents.map(e => (
                <div key={e.id} className="flex items-center justify-between px-3 py-1.5 rounded text-xs" style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}>
                  <span>{e.title} {e.type && `(${e.type})`}</span>
                  <button onClick={() => removeEvent(e.id)} className="hover:text-red-500">x</button>
                </div>
              ))}
            </div>
          )}
          <div className="space-y-1">
            {(selectedDayData?.articles || []).map(a => (
              <div key={a.id} className="flex items-center gap-2 text-xs py-1">
                {a.cl_sentiment_score && <span className="font-mono font-bold w-5 text-center" style={{ color: sentimentDot(a.cl_sentiment_score) }}>{a.cl_sentiment_score}</span>}
                <span className="flex-1 truncate" style={{ color: 'var(--text-primary)' }}>{a.headline}</span>
                <span style={{ color: 'var(--text-muted)' }}>{a.outlet}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
