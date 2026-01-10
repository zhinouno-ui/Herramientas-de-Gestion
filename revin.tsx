
import React, { useState, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';

// ==========================================
// 1. TIPOS Y CONFIGURACIÓN
// ==========================================

enum ContactStatus {
  SIN_REVISAR = 'sin revisar',
  JUGANDO = 'jugando',
  CONTACTADO = 'contactado',
  NO_INTERESADO = 'no interesado',
  SIN_WSP = 'sin wsp'
}

interface Contact {
  id: string;
  name: string;
  phone: string;
  origin: string;
  status: ContactStatus;
  seenReplied: boolean;
  recovered: boolean;
  interested: boolean;
  lastUpdated: number;
}

const STATUS_CONFIG: Record<ContactStatus, any> = {
  [ContactStatus.SIN_REVISAR]: { label: 'Sin Revisar', color: 'bg-slate-500', borderColor: 'border-slate-500', textColor: 'text-slate-400' },
  [ContactStatus.JUGANDO]: { label: 'Jugando', color: 'bg-purple-600', borderColor: 'border-purple-600', textColor: 'text-purple-400' },
  [ContactStatus.CONTACTADO]: { label: 'Contactado', color: 'bg-emerald-500', borderColor: 'border-emerald-500', textColor: 'text-emerald-400' },
  [ContactStatus.NO_INTERESADO]: { label: 'No Interesado', color: 'bg-rose-500', borderColor: 'border-rose-500', textColor: 'text-rose-400' },
  [ContactStatus.SIN_WSP]: { label: 'Sin WSP', color: 'bg-gray-600', borderColor: 'border-gray-600', textColor: 'text-gray-400' }
};

// ==========================================
// 2. MOTOR DE IMPORTACIÓN
// ==========================================

const parseCSV = (csvText: string): Contact[] => {
  const lines = csvText.split(/\r?\n/);
  if (lines.length < 2) return [];
  
  const headers = lines[0].toLowerCase().split(',').map(h => h.replace(/"/g, '').trim());
  const idxUser = headers.indexOf('usuarios');
  const idxRevStatus = headers.indexOf('estado de revision');
  const idxActualStatus = headers.indexOf('estado actual');
  const idxInterested = headers.indexOf('interesado en jugar?');

  if (idxUser === -1) return [];

  return lines.slice(1).map(line => {
    const cols = line.split(',').map(c => c.replace(/"/g, '').trim());
    const name = cols[idxUser];
    if (!name || name.toLowerCase() === 'eliminado' || name === '') return null;

    const rawRevStatus = cols[idxRevStatus]?.toLowerCase() || '';
    const rawActualStatus = cols[idxActualStatus]?.toLowerCase() || '';
    const rawInterested = cols[idxInterested]?.toLowerCase() || '';

    let status = ContactStatus.SIN_REVISAR;
    if (rawInterested === 'no') status = ContactStatus.NO_INTERESADO;
    else if (rawRevStatus.includes('cargando') || rawRevStatus.includes('esta cargando')) status = ContactStatus.JUGANDO;
    else if (rawActualStatus.includes('contacto') || rawActualStatus.includes('en contacto')) status = ContactStatus.CONTACTADO;
    else if (rawRevStatus.includes('no esta en wsp')) status = ContactStatus.SIN_WSP;

    return {
      id: crypto.randomUUID(),
      name,
      phone: '', 
      origin: 'PLANILLA',
      status,
      seenReplied: cols[4]?.toUpperCase() === 'SI',
      recovered: cols[5]?.toUpperCase() === 'SI',
      interested: rawInterested !== 'no',
      lastUpdated: Date.now()
    };
  }).filter(c => c !== null) as Contact[];
};

const parseVCF = (vcfText: string): Contact[] => {
  const contacts: Contact[] = [];
  vcfText.split(/END:VCARD/i).forEach(block => {
    if (!block.includes('BEGIN:VCARD')) return;
    const name = block.match(/FN:(.+)/i)?.[1].trim() || 'Sin nombre';
    const phone = block.match(/TEL[^:]*:(.+)/i)?.[1].replace(/\D/g, '') || '';
    contacts.push({
      id: crypto.randomUUID(),
      name,
      phone,
      origin: 'PC',
      status: ContactStatus.SIN_REVISAR,
      seenReplied: false, recovered: false, interested: true,
      lastUpdated: Date.now()
    });
  });
  return contacts;
};

// ==========================================
// 3. COMPONENTE APP
// ==========================================

const App: React.FC = () => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [viewMode, setViewMode] = useState<'cards' | 'list' | 'tinder'>('cards');
  const [currentFilter, setCurrentFilter] = useState<ContactStatus | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [tinderIndex, setTinderIndex] = useState(0);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('revin_v3_data');
    if (saved) setContacts(JSON.parse(saved));
  }, []);

  useEffect(() => {
    localStorage.setItem('revin_v3_data', JSON.stringify(contacts));
  }, [contacts]);

  const stats = useMemo(() => {
    const s: any = { total: contacts.length };
    Object.values(ContactStatus).forEach(v => {
      s[v] = contacts.filter(c => c.status === v).length;
    });
    return s;
  }, [contacts]);

  const filtered = useMemo(() => {
    return contacts.filter(c => {
      const fMatch = currentFilter === 'all' || c.status === currentFilter;
      const sMatch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) || c.phone.includes(searchTerm);
      return fMatch && sMatch;
    });
  }, [contacts, currentFilter, searchTerm]);

  const handleImport = async (e: any, type: 'csv' | 'vcf') => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const newData = type === 'csv' ? parseCSV(text) : parseVCF(text);
    
    setContacts(prev => {
      const map = new Map(prev.map(c => [c.name.toLowerCase(), c]));
      newData.forEach(n => {
        const key = n.name.toLowerCase();
        if (map.has(key)) {
          const existing = map.get(key)!;
          map.set(key, { ...existing, ...n, id: existing.id, phone: existing.phone || n.phone });
        } else {
          map.set(key, n);
        }
      });
      return Array.from(map.values());
    });
    setIsImportOpen(false);
  };

  const exportCSV = () => {
    const headers = ["usuarios", "estado de revision", "", "estado actual", "VISTO, RESPONDIDO?", "RECUPERADO", "TURNO DE LAS CARGAS", "interesado en jugar?", "ya contactados", "recuperados!", "actualmente cargando", "TURNO MAÑANA", "TURNO TARDE", "TURNO NOCHE", "contactos a borrar"];
    const playing = contacts.filter(c => c.status === ContactStatus.JUGANDO).map(c => c.name);
    const contacted = contacts.filter(c => c.status === ContactStatus.CONTACTADO).map(c => c.name);
    const recovered = contacts.filter(c => c.recovered).map(c => c.name);

    const rows = contacts.map((c, i) => [
      c.name,
      c.status === ContactStatus.SIN_WSP ? "no esta en wsp" : (c.status === ContactStatus.JUGANDO ? "esta cargando" : "promo enviada"),
      "",
      c.status === ContactStatus.CONTACTADO || c.status === ContactStatus.JUGANDO ? "EN CONTACTO" : (c.status === ContactStatus.SIN_WSP ? "NO ESTA EN WSP" : "MENSAJE ENVIADO"),
      c.seenReplied ? "SI" : "NO",
      c.recovered ? "SI" : "NO",
      "",
      c.status === ContactStatus.NO_INTERESADO ? "NO" : "SI",
      contacted[i] || "",
      recovered[i] || "",
      playing[i] || "",
      "", "", "", ""
    ].join(','));

    const blob = new Blob([[headers.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `planilla_revin.csv`;
    link.click();
  };

  const exportVCF = () => {
    const vcf = contacts.map(c => `BEGIN:VCARD\nVERSION:3.0\nFN:${c.name}\nTEL;TYPE=CELL:${c.phone}\nEND:VCARD`).join('\n\n');
    const blob = new Blob([vcf], { type: 'text/vcard' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `agenda_revin.vcf`;
    link.click();
  };

  const saveEdit = (e: any) => {
    e.preventDefault();
    if (!editContact) return;
    setContacts(prev => prev.map(c => c.id === editContact.id ? editContact : c));
    setEditContact(null);
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 p-4 md:p-8 flex flex-col items-center">
      <header className="w-full max-w-5xl flex flex-col md:flex-row justify-between items-center gap-4 mb-8">
        <div>
          <h1 className="text-4xl font-black bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent tracking-tighter">REVIN GESTOR V3</h1>
          <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.3em] mt-1">Planilla & Contactos Master</p>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <button onClick={() => setIsImportOpen(true)} className="flex-1 md:flex-none bg-blue-600 hover:bg-blue-500 px-8 py-3.5 rounded-2xl font-black flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg shadow-blue-900/20">
            <i className="fas fa-file-import"></i> IMPORTAR
          </button>
          <div className="relative group flex-1 md:flex-none">
            <button className="w-full bg-emerald-600 hover:bg-emerald-500 px-8 py-3.5 rounded-2xl font-black flex items-center justify-center gap-3 transition-all active:scale-95 shadow-lg shadow-emerald-900/20">
              <i className="fas fa-download"></i> EXPORTAR
            </button>
            <div className="absolute top-full right-0 mt-2 w-48 bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 overflow-hidden">
              <button onClick={exportCSV} className="w-full p-4 text-left hover:bg-slate-700 flex items-center gap-3 border-b border-slate-700/50 font-bold text-sm"><i className="fas fa-file-csv text-blue-400"></i> Planilla (CSV)</button>
              <button onClick={exportVCF} className="w-full p-4 text-left hover:bg-slate-700 flex items-center gap-3 font-bold text-sm"><i className="fas fa-address-book text-emerald-400"></i> Agenda (VCF)</button>
            </div>
          </div>
          <button onClick={() => confirm('¿Eliminar base completa?') && setContacts([])} className="bg-slate-800 hover:bg-rose-900/40 px-5 py-3.5 rounded-2xl text-slate-500 hover:text-rose-400 border border-slate-700 transition-all"><i className="fas fa-trash-alt"></i></button>
        </div>
      </header>

      {/* FILTROS DINÁMICOS */}
      <section className="w-full max-w-5xl bg-slate-800/40 border border-slate-700/50 p-6 rounded-[2.5rem] mb-8 shadow-inner backdrop-blur-sm">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 mb-6">
          <button onClick={() => setCurrentFilter('all')} className={`p-4 rounded-3xl border transition-all flex flex-col items-center gap-1 ${currentFilter === 'all' ? 'border-blue-500 bg-blue-500/10 shadow-lg shadow-blue-500/5' : 'border-slate-700 hover:bg-slate-800'}`}>
            <span className="text-3xl font-black text-white leading-none">{stats.total}</span>
            <span className="text-[10px] text-slate-500 font-black uppercase tracking-widest">TOTAL</span>
          </button>
          {Object.values(ContactStatus).map(s => (
            <button key={s} onClick={() => setCurrentFilter(s)} className={`p-4 rounded-3xl border transition-all flex flex-col items-center gap-1 ${currentFilter === s ? STATUS_CONFIG[s].borderColor + ' bg-slate-800 shadow-xl' : 'border-slate-700 hover:bg-slate-800'}`}>
              <span className={`text-3xl font-black leading-none ${STATUS_CONFIG[s].textColor}`}>{stats[s]}</span>
              <span className="text-[10px] text-slate-500 font-black uppercase text-center leading-tight tracking-tighter">{STATUS_CONFIG[s].label}</span>
            </button>
          ))}
        </div>
        <div className="h-3 bg-slate-900 rounded-full overflow-hidden flex shadow-inner">
          {Object.values(ContactStatus).map(s => (
            <div key={s} style={{ width: `${stats.total ? (stats[s]/stats.total)*100 : 0}%` }} className={`${STATUS_CONFIG[s].color} h-full transition-all duration-1000 ease-out`} />
          ))}
        </div>
      </section>

      {/* CONTROLES DE VISTA */}
      <div className="w-full max-w-5xl flex flex-col md:flex-row gap-4 mb-8">
        <div className="bg-slate-800 p-1.5 rounded-2xl border border-slate-700 flex h-14 md:h-auto shadow-xl">
          <button onClick={() => setViewMode('cards')} className={`flex-1 px-8 py-2 rounded-xl font-black text-xs transition-all ${viewMode === 'cards' ? 'bg-blue-600 shadow-lg text-white' : 'text-slate-500 hover:text-slate-300'}`}>CARDS</button>
          <button onClick={() => setViewMode('list')} className={`hidden md:block px-8 py-2 rounded-xl font-black text-xs transition-all ${viewMode === 'list' ? 'bg-blue-600 shadow-lg text-white' : 'text-slate-500 hover:text-slate-300'}`}>LISTA</button>
          <button onClick={() => { setViewMode('tinder'); setTinderIndex(0); }} className={`flex-1 px-8 py-2 rounded-xl font-black text-xs transition-all ${viewMode === 'tinder' ? 'bg-rose-600 shadow-lg text-white' : 'text-slate-500 hover:text-slate-300'}`}><i className="fas fa-fire mr-2"></i> REVISIÓN</button>
        </div>
        <div className="relative flex-1 group">
          <i className="fas fa-search absolute left-6 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-400 transition-colors"></i>
          <input type="text" placeholder="Buscar por nombre o número..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full h-14 md:h-full bg-slate-800 border border-slate-700 py-4 pl-16 pr-6 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500/50 font-black text-white placeholder-slate-600 transition-all shadow-lg" />
        </div>
      </div>

      {/* CONTENIDO PRINCIPAL */}
      <main className="w-full max-w-5xl flex-1 pb-24">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-center opacity-30 animate-fadeIn">
            <i className="fas fa-users-slash text-8xl mb-6"></i>
            <h2 className="text-3xl font-black uppercase tracking-widest">Sin resultados</h2>
          </div>
        ) : (
          <>
            {viewMode === 'cards' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 animate-fadeIn">
                {filtered.map(c => (
                  <div key={c.id} className={`bg-slate-800/80 backdrop-blur-md p-6 rounded-[2.5rem] border-t-8 ${STATUS_CONFIG[c.status].borderColor} shadow-2xl transition-all hover:-translate-y-2`}>
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h3 className="font-black text-2xl text-white truncate max-w-[200px] leading-tight">{c.name}</h3>
                        <span className="inline-block mt-1 bg-slate-900/50 text-[10px] font-black text-slate-500 px-3 py-1 rounded-full border border-slate-700/50 uppercase tracking-tighter">{c.origin}</span>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => setEditContact(c)} className="p-3 text-slate-500 hover:text-blue-400 hover:bg-blue-400/10 rounded-2xl transition-all"><i className="fas fa-pen text-sm"></i></button>
                        <button onClick={() => confirm('¿Borrar?') && setContacts(prev => prev.filter(x => x.id !== c.id))} className="p-3 text-slate-500 hover:text-rose-500 hover:bg-rose-500/10 rounded-2xl transition-all"><i className="fas fa-trash-alt text-sm"></i></button>
                      </div>
                    </div>
                    <div className="mb-6 bg-slate-900/60 p-4 rounded-2xl border border-slate-700/30 text-center font-mono text-blue-400 font-black text-xl shadow-inner">{c.phone || 'SIN NÚMERO'}</div>
                    <div className="grid grid-cols-2 gap-2 mb-6">
                      {Object.values(ContactStatus).map(s => (
                        <button key={s} onClick={() => setContacts(prev => prev.map(x => x.id === c.id ? {...x, status: s, lastUpdated: Date.now()} : x))} className={`text-[10px] font-black py-3 rounded-xl border transition-all ${c.status === s ? STATUS_CONFIG[s].color + ' border-transparent text-white shadow-lg' : 'border-slate-700 text-slate-500 hover:bg-slate-700 uppercase'}`}>{STATUS_CONFIG[s].label}</button>
                      ))}
                    </div>
                    {c.phone && <a href={`https://wa.me/${c.phone}`} target="_blank" className="w-full bg-emerald-600 hover:bg-emerald-500 py-4.5 rounded-[1.5rem] font-black flex items-center justify-center gap-4 transition-all active:scale-95 shadow-xl shadow-emerald-900/30 text-white text-lg"><i className="fab fa-whatsapp text-2xl"></i> WHATSAPP</a>}
                  </div>
                ))}
              </div>
            )}

            {viewMode === 'list' && (
              <div className="hidden md:block bg-slate-800 rounded-[2.5rem] border border-slate-700 overflow-hidden shadow-2xl animate-fadeIn">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-900/50 text-[10px] text-slate-500 uppercase font-black border-b border-slate-700 tracking-widest">
                      <th className="px-8 py-6">Usuario / Info</th>
                      <th className="px-8 py-6 text-center">WhatsApp</th>
                      <th className="px-8 py-6 text-center">Estado de Gestión</th>
                      <th className="px-8 py-6 text-right">Opciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/50">
                    {filtered.map(c => (
                      <tr key={c.id} className="hover:bg-slate-700/30 group transition-colors">
                        <td className="px-8 py-5">
                          <div className="font-black text-lg text-white">{c.name}</div>
                          <div className="text-[10px] text-slate-500 uppercase font-bold tracking-tighter">{c.origin}</div>
                        </td>
                        <td className="px-8 py-5 text-center font-mono text-blue-400 font-black text-lg">{c.phone || '---'}</td>
                        <td className="px-8 py-5 text-center">
                          <select value={c.status} onChange={e => setContacts(prev => prev.map(x => x.id === c.id ? {...x, status: e.target.value as ContactStatus, lastUpdated: Date.now()} : x))} className={`bg-slate-900 text-[10px] font-black border rounded-xl px-5 py-2.5 outline-none appearance-none text-center min-w-[150px] cursor-pointer ${STATUS_CONFIG[c.status].borderColor} ${STATUS_CONFIG[c.status].textColor}`}>
                            {Object.values(ContactStatus).map(s => <option key={s} value={s}>{STATUS_CONFIG[s].label.toUpperCase()}</option>)}
                          </select>
                        </td>
                        <td className="px-8 py-5 text-right">
                          <div className="flex justify-end gap-1 opacity-40 group-hover:opacity-100 transition-all">
                            {c.phone && <a href={`https://wa.me/${c.phone}`} target="_blank" className="text-emerald-400 p-4 hover:bg-emerald-500/10 rounded-2xl transition-all"><i className="fab fa-whatsapp"></i></a>}
                            <button onClick={() => setEditContact(c)} className="text-blue-400 p-4 hover:bg-blue-500/10 rounded-2xl transition-all"><i className="fas fa-edit"></i></button>
                            <button onClick={() => confirm('¿Borrar?') && setContacts(prev => prev.filter(x => x.id !== c.id))} className="text-rose-500 p-4 hover:bg-rose-500/10 rounded-2xl transition-all"><i className="fas fa-trash-alt"></i></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {viewMode === 'tinder' && filtered[tinderIndex] && (
              <div className="flex flex-col items-center max-w-sm mx-auto pt-6 animate-slideUp">
                <div className={`w-full bg-slate-800 p-10 rounded-[3.5rem] border-t-[16px] ${STATUS_CONFIG[filtered[tinderIndex].status].borderColor} shadow-[0_40px_100px_rgba(0,0,0,0.6)] relative`}>
                  <div className="absolute top-8 right-10 text-slate-600 font-black text-xs tracking-[0.2em]">{tinderIndex + 1} / {filtered.length}</div>
                  <div className="mb-12 text-center">
                    <h2 className="text-5xl font-black break-words leading-none mb-4 text-white uppercase tracking-tighter">{filtered[tinderIndex]?.name}</h2>
                    <span className="bg-slate-700 text-slate-300 text-[10px] font-black px-5 py-2 rounded-full uppercase tracking-[0.2em] border border-slate-600">{filtered[tinderIndex]?.origin}</span>
                  </div>
                  <div className="bg-slate-900/80 p-8 rounded-[2rem] mb-12 border border-slate-700 text-center shadow-inner">
                    <p className="text-[10px] font-black text-slate-500 uppercase mb-2 tracking-[0.3em]">Direct WhatsApp</p>
                    <p className="text-4xl font-mono text-blue-400 tracking-widest font-black leading-none">{filtered[tinderIndex]?.phone || 'SIN NÚMERO'}</p>
                  </div>
                  {filtered[tinderIndex]?.phone && (
                    <a href={`https://wa.me/${filtered[tinderIndex].phone}`} target="_blank" className="w-full bg-emerald-600 py-7 rounded-[2.5rem] font-black text-2xl mb-10 flex items-center justify-center gap-5 active:scale-90 transition-all shadow-2xl shadow-emerald-900/50 text-white"><i className="fab fa-whatsapp text-5xl"></i> ABRIR CHAT</a>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <button onClick={() => { setContacts(prev => prev.map(x => x.id === filtered[tinderIndex].id ? {...x, status: ContactStatus.JUGANDO, lastUpdated: Date.now()} : x)); setTinderIndex(i => (i + 1) % filtered.length); }} className="bg-purple-600 py-7 rounded-3xl font-black text-xs active:scale-95 transition-all shadow-xl uppercase">JUGANDO</button>
                    <button onClick={() => { setContacts(prev => prev.map(x => x.id === filtered[tinderIndex].id ? {...x, status: ContactStatus.CONTACTADO, lastUpdated: Date.now()} : x)); setTinderIndex(i => (i + 1) % filtered.length); }} className="bg-emerald-500 py-7 rounded-3xl font-black text-xs active:scale-95 transition-all shadow-xl uppercase">CONTACTADO</button>
                    <button onClick={() => { setContacts(prev => prev.map(x => x.id === filtered[tinderIndex].id ? {...x, status: ContactStatus.NO_INTERESADO, lastUpdated: Date.now()} : x)); setTinderIndex(i => (i + 1) % filtered.length); }} className="bg-rose-500 py-7 rounded-3xl font-black text-xs active:scale-95 transition-all shadow-xl uppercase text-white">NO INTERÉS</button>
                    <button onClick={() => { setContacts(prev => prev.map(x => x.id === filtered[tinderIndex].id ? {...x, status: ContactStatus.SIN_WSP, lastUpdated: Date.now()} : x)); setTinderIndex(i => (i + 1) % filtered.length); }} className="bg-slate-600 py-7 rounded-3xl font-black text-xs active:scale-95 transition-all shadow-xl uppercase">SIN WSP</button>
                  </div>
                  <div className="flex justify-between mt-12 text-slate-500 font-black text-[10px] uppercase pt-10 border-t border-slate-700/50 tracking-widest">
                    <button disabled={tinderIndex === 0} onClick={() => setTinderIndex(i => i - 1)} className="disabled:opacity-20 flex items-center gap-3 px-6 py-2 hover:text-white transition-all"><i className="fas fa-arrow-left"></i> Anterior</button>
                    <button onClick={() => setTinderIndex(i => (i + 1) % filtered.length)} className="flex items-center gap-3 px-6 py-2 hover:text-white transition-all">Siguiente <i className="fas fa-arrow-right"></i></button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* MODAL IMPORTACIÓN */}
      {isImportOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md animate-fadeIn" onClick={() => setIsImportOpen(false)}></div>
          <div className="relative bg-slate-800 border border-slate-700 p-10 md:p-14 rounded-[4.5rem] w-full max-w-md shadow-3xl animate-slideUp">
            <h2 className="text-4xl font-black mb-12 text-center uppercase tracking-tighter text-white">Sincronizar Datos</h2>
            <div className="space-y-6">
              <div className="relative border-4 border-dashed border-slate-700 p-12 rounded-[3rem] hover:border-blue-500 text-center cursor-pointer transition-all group overflow-hidden bg-slate-900/30">
                <input type="file" accept=".csv" onChange={e => handleImport(e, 'csv')} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
                <div className="group-hover:scale-110 transition-transform duration-300">
                  <i className="fas fa-file-csv text-7xl text-blue-400 mb-5"></i>
                  <p className="font-black text-white uppercase text-sm tracking-widest">Planilla Sheets</p>
                  <p className="text-[10px] text-slate-500 font-bold mt-2 uppercase tracking-[0.2em] italic">Busca "Usuarios"</p>
                </div>
              </div>
              <div className="relative border-4 border-dashed border-slate-700 p-12 rounded-[3rem] hover:border-emerald-500 text-center cursor-pointer transition-all group overflow-hidden bg-slate-900/30">
                <input type="file" accept=".vcf,.vcard" onChange={e => handleImport(e, 'vcf')} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
                <div className="group-hover:scale-110 transition-transform duration-300">
                  <i className="fas fa-address-book text-7xl text-emerald-400 mb-5"></i>
                  <p className="font-black text-white uppercase text-sm tracking-widest">Agenda VCF</p>
                  <p className="text-[10px] text-slate-500 font-bold mt-2 uppercase tracking-[0.2em] italic">Actualiza Números</p>
                </div>
              </div>
            </div>
            <button onClick={() => setIsImportOpen(false)} className="w-full mt-10 py-6 font-black text-slate-500 uppercase text-xs hover:text-white transition-colors tracking-[0.4em]">Cancelar</button>
          </div>
        </div>
      )}

      {/* MODAL EDICIÓN PERFIL */}
      {editContact && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md animate-fadeIn" onClick={() => setEditContact(null)}></div>
          <form onSubmit={saveEdit} className="relative bg-slate-800 border border-slate-700 p-12 rounded-[4rem] w-full max-w-md shadow-3xl animate-slideUp">
            <h2 className="text-4xl font-black mb-10 uppercase tracking-tighter text-white text-center leading-none">Editar Perfil</h2>
            <div className="space-y-8">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase block mb-3 px-3 tracking-[0.3em]">Nombre de Usuario</label>
                <input required type="text" value={editContact.name} onChange={e => setEditContact({...editContact, name: e.target.value})} className="w-full bg-slate-900 border border-slate-700 p-7 rounded-[2rem] outline-none font-black text-white text-2xl shadow-inner focus:ring-4 focus:ring-blue-500/20 transition-all" />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase block mb-3 px-3 tracking-[0.3em]">WhatsApp Number</label>
                <input type="text" value={editContact.phone} onChange={e => setEditContact({...editContact, phone: e.target.value.replace(/\D/g,'')})} className="w-full bg-slate-900 border border-slate-700 p-7 rounded-[2rem] outline-none font-mono text-blue-400 text-3xl shadow-inner focus:ring-4 focus:ring-blue-500/20 transition-all" placeholder="Ej: 351..." />
              </div>
            </div>
            <div className="flex gap-4 mt-12">
              <button type="button" onClick={() => setEditContact(null)} className="flex-1 py-7 font-black text-slate-500 uppercase text-xs hover:bg-slate-700 rounded-3xl transition-all tracking-widest">Cerrar</button>
              <button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-500 py-7 rounded-3xl font-black uppercase text-xs shadow-2xl transition-all active:scale-95 text-white tracking-widest">Guardar</button>
            </div>
          </form>
        </div>
      )}

      {/* BOTÓN FLOTANTE REVISIÓN (CELULAR) */}
      {contacts.length > 0 && viewMode !== 'tinder' && (
        <button onClick={() => { setViewMode('tinder'); setTinderIndex(0); }} className="md:hidden fixed bottom-12 right-12 w-28 h-28 bg-rose-600 rounded-full flex items-center justify-center text-white shadow-[0_25px_60px_rgba(225,29,72,0.6)] z-40 border-[12px] border-[#0f172a] active:scale-75 transition-all">
          <i className="fas fa-fire text-5xl"></i>
        </button>
      )}
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
