
import React, { useState, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';

// ==========================================
// 1. CONFIGURACIÓN Y ESTADOS
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
  [ContactStatus.SIN_REVISAR]: { label: 'Sin Revisar', color: 'bg-slate-500', borderColor: 'border-slate-500', textColor: 'text-slate-400', icon: 'fa-clock' },
  [ContactStatus.JUGANDO]: { label: 'Jugando', color: 'bg-purple-600', borderColor: 'border-purple-600', textColor: 'text-purple-400', icon: 'fa-gamepad' },
  [ContactStatus.CONTACTADO]: { label: 'Contactado', color: 'bg-emerald-500', borderColor: 'border-emerald-500', textColor: 'text-emerald-400', icon: 'fa-check' },
  [ContactStatus.NO_INTERESADO]: { label: 'No Interesado', color: 'bg-rose-500', borderColor: 'border-rose-500', textColor: 'text-rose-400', icon: 'fa-times' },
  [ContactStatus.SIN_WSP]: { label: 'Sin WSP', color: 'bg-gray-600', borderColor: 'border-gray-600', textColor: 'text-gray-400', icon: 'fa-ban' }
};

// ==========================================
// 2. MOTOR DE PROCESAMIENTO (CSV/VCF)
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

    // PRIORIDAD DE ESTADOS SEGÚN TU FORMATO DE PLANILLA
    if (rawInterested === 'no') {
      status = ContactStatus.NO_INTERESADO;
    } else if (rawRevStatus.includes('cargando') || rawRevStatus.includes('esta cargando')) {
      status = ContactStatus.JUGANDO;
    } else if (rawActualStatus.includes('contacto') || rawActualStatus.includes('en contacto')) {
      status = ContactStatus.CONTACTADO;
    } else if (rawRevStatus.includes('no esta en wsp')) {
      status = ContactStatus.SIN_WSP;
    }

    return {
      id: crypto.randomUUID(),
      name: name,
      phone: '', 
      origin: 'PLANILLA',
      status,
      seenReplied: cols[4]?.toUpperCase() === 'SI',
      recovered: cols[5]?.toUpperCase() === 'SI',
      interested: rawInterested === 'si',
      lastUpdated: Date.now()
    };
  }).filter(c => c !== null) as Contact[];
};

const parseVCF = (vcfText: string): Contact[] => {
  const contacts: Contact[] = [];
  vcfText.split(/END:VCARD/i).forEach(block => {
    if (!block.includes('BEGIN:VCARD')) return;
    const name = block.match(/FN:(.+)/i)?.[1].trim() || 'Sin nombre';
    const phoneMatch = block.match(/TEL[^:]*:(.+)/i);
    const phone = phoneMatch ? phoneMatch[1].replace(/\D/g, '') : '';
    
    contacts.push({
      id: crypto.randomUUID(),
      name,
      phone,
      origin: 'PC',
      status: ContactStatus.SIN_REVISAR,
      seenReplied: false, 
      recovered: false, 
      interested: false,
      lastUpdated: Date.now()
    });
  });
  return contacts;
};

// ==========================================
// 3. COMPONENTE PRINCIPAL
// ==========================================

const App: React.FC = () => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [viewMode, setViewMode] = useState<'cards' | 'list' | 'tinder'>('cards');
  const [currentFilter, setCurrentFilter] = useState<ContactStatus | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [tinderIndex, setTinderIndex] = useState(0);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);

  // Persistencia LocalStorage
  useEffect(() => {
    const saved = localStorage.getItem('gestor_v3_final_data');
    if (saved) setContacts(JSON.parse(saved));
  }, []);

  useEffect(() => {
    localStorage.setItem('gestor_v3_final_data', JSON.stringify(contacts));
  }, [contacts]);

  const stats = useMemo(() => {
    const s: Record<string, number> = { total: contacts.length };
    (Object.values(ContactStatus) as ContactStatus[]).forEach(v => {
      s[v] = contacts.filter(c => c.status === v).length;
    });
    return s;
  }, [contacts]);

  const filteredContacts = useMemo(() => {
    return contacts.filter(c => {
      const matchesFilter = currentFilter === 'all' || c.status === currentFilter;
      const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                           c.phone.includes(searchTerm);
      return matchesFilter && matchesSearch;
    });
  }, [contacts, currentFilter, searchTerm]);

  // Manejo de Importación
  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>, type: 'csv' | 'vcf') => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const newData = type === 'csv' ? parseCSV(text) : parseVCF(text);
    
    setContacts(prev => {
      const map = new Map(prev.map(c => [c.name.toLowerCase(), c]));
      newData.forEach(n => {
        const key = n.name.toLowerCase();
        if (map.has(key)) {
          // Si existe, actualizamos priorizando la data de la planilla si viene de CSV
          const existing = map.get(key)!;
          map.set(key, { 
            ...existing, 
            ...n, 
            id: existing.id, 
            phone: existing.phone || n.phone 
          });
        } else {
          map.set(key, n);
        }
      });
      return Array.from(map.values());
    });
    setIsImportOpen(false);
    // Limpiar input
    e.target.value = '';
  };

  // Exportación CSV (Manteniendo tu formato exacto)
  const exportToCSV = () => {
    const headers = ["usuarios", "estado de revision", "", "estado actual", "VISTO, RESPONDIDO?", "RECUPERADO", "TURNO DE LAS CARGAS", "interesado en jugar?", "ya contactados", "recuperados!", "actualmente cargando", "TURNO MAÑANA", "TURNO TARDE", "TURNO NOCHE", "contactos a borrar"];
    
    const playingNames = contacts.filter(c => c.status === ContactStatus.JUGANDO).map(c => c.name);
    const contactedNames = contacts.filter(c => c.status === ContactStatus.CONTACTADO).map(c => c.name);
    const recoveredNames = contacts.filter(c => c.recovered).map(c => c.name);

    const rows = contacts.map((c, i) => {
      const revision = c.status === ContactStatus.JUGANDO ? "esta cargando" : (c.status === ContactStatus.SIN_WSP ? "no esta en wsp" : "promo enviada");
      const actual = (c.status === ContactStatus.CONTACTADO || c.status === ContactStatus.JUGANDO) ? "EN CONTACTO" : (c.status === ContactStatus.SIN_WSP ? "NO ESTA EN WSP" : "MENSAJE ENVIADO");
      
      return [
        c.name,
        revision,
        "",
        actual,
        c.seenReplied ? "SI" : "NO",
        c.recovered ? "SI" : "NO",
        "",
        c.status === ContactStatus.NO_INTERESADO ? "NO" : "SI",
        contactedNames[i] || "",
        recoveredNames[i] || "",
        playingNames[i] || "",
        "", "", "", ""
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `planilla_gestion_${new Date().toLocaleDateString()}.csv`;
    link.click();
  };

  const exportToVCF = () => {
    const vcfContent = contacts.map(c => 
      `BEGIN:VCARD\nVERSION:3.0\nFN:${c.name}\nTEL;TYPE=CELL:${c.phone}\nNOTE:Origin:${c.origin} Status:${c.status}\nEND:VCARD`
    ).join('\n\n');
    const blob = new Blob([vcfContent], { type: 'text/vcard;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `contactos_export_${new Date().toLocaleDateString()}.vcf`;
    link.click();
  };

  const handleStatusChange = (id: string, newStatus: ContactStatus) => {
    setContacts(prev => prev.map(c => c.id === id ? { ...c, status: newStatus, lastUpdated: Date.now() } : c));
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editContact) return;
    setContacts(prev => prev.map(c => c.id === editContact.id ? { ...editContact, lastUpdated: Date.now() } : c));
    setEditContact(null);
  };

  const deleteContact = (id: string) => {
    if (confirm('¿Seguro que querés eliminar este contacto?')) {
      setContacts(prev => prev.filter(c => c.id !== id));
    }
  };

  return (
    <div className="min-h-screen flex flex-col p-4 md:p-8 bg-[#0f172a] text-slate-200">
      
      {/* Header */}
      <header className="max-w-6xl mx-auto w-full flex flex-col md:flex-row justify-between items-center gap-6 mb-8">
        <div className="text-center md:text-left">
          <h1 className="text-4xl font-black bg-gradient-to-r from-blue-400 via-purple-400 to-emerald-400 bg-clip-text text-transparent tracking-tighter">
            GESTOR CONTACTOS PRO
          </h1>
          <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1">Version 3.0 Final • Planilla Master</p>
        </div>

        <div className="flex flex-wrap justify-center gap-3 w-full md:w-auto">
          <button onClick={() => setIsImportOpen(true)} className="flex-1 md:flex-none bg-blue-600 hover:bg-blue-500 px-6 py-3 rounded-2xl font-black flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20 transition-all active:scale-95">
            <i className="fas fa-file-import"></i> IMPORTAR
          </button>
          
          <div className="relative group flex-1 md:flex-none">
            <button className="w-full bg-emerald-600 hover:bg-emerald-500 px-6 py-3 rounded-2xl font-black flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20 transition-all active:scale-95">
              <i className="fas fa-file-export"></i> EXPORTAR
            </button>
            <div className="absolute top-full right-0 mt-2 w-48 bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[60] overflow-hidden">
              <button onClick={exportToCSV} className="w-full p-4 text-left hover:bg-slate-700 flex items-center gap-3 border-b border-slate-700/50 text-sm font-bold"><i className="fas fa-file-csv text-blue-400"></i> Planilla (CSV)</button>
              <button onClick={exportToVCF} className="w-full p-4 text-left hover:bg-slate-700 flex items-center gap-3 text-sm font-bold"><i className="fas fa-address-book text-emerald-400"></i> Agenda (VCF)</button>
            </div>
          </div>

          <button onClick={() => confirm('¿Borrar absolutamente toda la base de datos?') && setContacts([])} className="bg-slate-800 hover:bg-rose-900/40 px-4 py-3 rounded-2xl text-slate-500 hover:text-rose-400 border border-slate-700 transition-all">
            <i className="fas fa-trash-alt"></i>
          </button>
        </div>
      </header>

      {/* Panel de Estadísticas y Filtros */}
      <section className="max-w-6xl mx-auto w-full bg-slate-800/40 border border-slate-700/50 p-4 md:p-6 rounded-[2.5rem] mb-8 shadow-inner">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 mb-6">
          <button 
            onClick={() => setCurrentFilter('all')} 
            className={`p-4 rounded-3xl border transition-all flex flex-col items-center justify-center gap-1 ${currentFilter === 'all' ? 'border-blue-500 bg-blue-500/10 shadow-[0_0_20px_rgba(59,130,246,0.15)]' : 'border-slate-700 hover:bg-slate-800'}`}
          >
            <span className="text-2xl font-black text-white">{stats.total}</span>
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">TOTAL</span>
          </button>
          
          {(Object.values(ContactStatus) as ContactStatus[]).map(s => (
            <button 
              key={s} 
              onClick={() => setCurrentFilter(s)}
              className={`p-4 rounded-3xl border transition-all flex flex-col items-center justify-center gap-1 ${currentFilter === s ? STATUS_CONFIG[s].borderColor + ' bg-slate-800 shadow-lg' : 'border-slate-700 hover:bg-slate-800'}`}
            >
              <span className={`text-2xl font-black ${STATUS_CONFIG[s].textColor}`}>{stats[s]}</span>
              <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest text-center leading-tight">{STATUS_CONFIG[s].label}</span>
            </button>
          ))}
        </div>
        
        {/* Barra de progreso visual */}
        <div className="h-3 bg-slate-900 rounded-full overflow-hidden flex shadow-inner">
          {(Object.values(ContactStatus) as ContactStatus[]).map(s => (
            <div 
              key={s} 
              style={{ width: `${stats.total ? (stats[s]/stats.total)*100 : 0}%` }} 
              className={`${STATUS_CONFIG[s].color} h-full transition-all duration-700 ease-out`} 
            />
          ))}
        </div>
      </section>

      {/* Controles de Vista y Búsqueda */}
      <div className="max-w-6xl mx-auto w-full flex flex-col md:flex-row gap-4 mb-8">
        <div className="bg-slate-800 p-1.5 rounded-[1.5rem] border border-slate-700 flex h-14 md:h-auto shadow-lg">
          <button onClick={() => setViewMode('cards')} className={`flex-1 px-8 py-2 rounded-2xl font-black text-xs transition-all ${viewMode === 'cards' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>CARDS</button>
          <button onClick={() => setViewMode('list')} className={`hidden md:block px-8 py-2 rounded-2xl font-black text-xs transition-all ${viewMode === 'list' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>LISTA</button>
          <button onClick={() => { setViewMode('tinder'); setTinderIndex(0); }} className={`flex-1 px-8 py-2 rounded-2xl font-black text-xs transition-all ${viewMode === 'tinder' ? 'bg-rose-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>REVISIÓN</button>
        </div>
        
        <div className="relative flex-1 group">
          <i className="fas fa-search absolute left-5 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-blue-400 transition-colors"></i>
          <input 
            type="text" 
            placeholder="Buscar por usuario o teléfono..." 
            value={searchTerm} 
            onChange={e => setSearchTerm(e.target.value)} 
            className="w-full h-14 md:h-full bg-slate-800 border border-slate-700 py-4 pl-14 pr-6 rounded-[1.5rem] focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all font-bold text-white placeholder-slate-600"
          />
        </div>
      </div>

      {/* Main Content Area */}
      <main className="max-w-6xl mx-auto w-full flex-1">
        {filteredContacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-center opacity-40">
            <div className="w-24 h-24 bg-slate-800 rounded-full flex items-center justify-center mb-6">
              <i className="fas fa-users-slash text-4xl"></i>
            </div>
            <h2 className="text-2xl font-black uppercase tracking-widest">Sin resultados</h2>
            <p className="text-sm font-bold mt-2">Probá cambiando el filtro o importando datos</p>
          </div>
        ) : (
          <>
            {/* VISTA CARDS */}
            {viewMode === 'cards' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 animate-fadeIn">
                {filteredContacts.map(c => (
                  <div key={c.id} className={`bg-slate-800/80 backdrop-blur-md p-6 rounded-[2.5rem] border-t-8 ${STATUS_CONFIG[c.status].borderColor} shadow-2xl transition-all hover:translate-y-[-4px]`}>
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="font-black text-2xl text-white truncate max-w-[180px] leading-tight">{c.name}</h3>
                        <span className="inline-block mt-1 bg-slate-900/50 text-[10px] font-black text-slate-500 px-3 py-1 rounded-full uppercase tracking-tighter border border-slate-700/50">
                          {c.origin}
                        </span>
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => setEditContact(c)} className="p-3 text-slate-500 hover:text-blue-400 hover:bg-blue-400/10 rounded-2xl transition-all"><i className="fas fa-pen text-sm"></i></button>
                        <button onClick={() => deleteContact(c.id)} className="p-3 text-slate-500 hover:text-rose-500 hover:bg-rose-500/10 rounded-2xl transition-all"><i className="fas fa-trash-alt text-sm"></i></button>
                      </div>
                    </div>

                    <div className="bg-slate-900/60 p-4 rounded-2xl mb-6 border border-slate-700/50 text-center group cursor-pointer active:scale-95 transition-all">
                      <p className="text-[10px] font-black text-slate-600 uppercase mb-1">WhatsApp</p>
                      <p className="text-lg font-mono text-blue-300 tracking-wider font-black">{c.phone || 'SIN NÚMERO'}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mb-6">
                      {(Object.values(ContactStatus) as ContactStatus[]).map(s => (
                        <button 
                          key={s} 
                          onClick={() => handleStatusChange(c.id, s)} 
                          className={`text-[10px] font-black py-3 rounded-xl border transition-all ${c.status === s ? STATUS_CONFIG[s].color + ' border-transparent text-white shadow-lg' : 'border-slate-700 text-slate-500 hover:bg-slate-700'}`}
                        >
                          {STATUS_CONFIG[s].label}
                        </button>
                      ))}
                    </div>

                    {c.phone && (
                      <a 
                        href={`https://wa.me/${c.phone}`} 
                        target="_blank" 
                        rel="noreferrer"
                        className="w-full bg-emerald-600 hover:bg-emerald-500 py-4 rounded-2xl font-black flex items-center justify-center gap-3 transition-all active:scale-95 shadow-xl shadow-emerald-900/30 text-white"
                      >
                        <i className="fab fa-whatsapp text-2xl"></i> ESCRIBIR
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* VISTA LISTA (SÓLO DESKTOP) */}
            {viewMode === 'list' && (
              <div className="hidden md:block bg-slate-800/60 rounded-[2.5rem] border border-slate-700 overflow-hidden shadow-2xl backdrop-blur-sm animate-fadeIn">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-slate-900/50 text-[10px] text-slate-500 uppercase font-black border-b border-slate-700">
                      <th className="px-8 py-6 tracking-widest">Usuario / Procedencia</th>
                      <th className="px-8 py-6 tracking-widest text-center">Teléfono</th>
                      <th className="px-8 py-6 tracking-widest text-center">Estado de Gestión</th>
                      <th className="px-8 py-6 tracking-widest text-right">Opciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/50 font-bold">
                    {filteredContacts.map(c => (
                      <tr key={c.id} className="hover:bg-slate-700/30 transition-colors group">
                        <td className="px-8 py-5">
                          <div className="text-white font-black text-lg">{c.name}</div>
                          <div className="text-[10px] text-slate-500 uppercase tracking-tighter mt-0.5">{c.origin}</div>
                        </td>
                        <td className="px-8 py-5 text-center">
                          <span className="font-mono text-blue-400 bg-slate-900 px-3 py-1 rounded-lg border border-slate-700">{c.phone || '---'}</span>
                        </td>
                        <td className="px-8 py-5 text-center">
                          <select 
                            value={c.status} 
                            onChange={e => handleStatusChange(c.id, e.target.value as ContactStatus)} 
                            className={`bg-slate-900 text-[10px] font-black border rounded-xl px-4 py-2 outline-none cursor-pointer appearance-none text-center min-w-[140px] ${STATUS_CONFIG[c.status].borderColor} ${STATUS_CONFIG[c.status].textColor}`}
                          >
                            {(Object.values(ContactStatus) as ContactStatus[]).map(s => <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>)}
                          </select>
                        </td>
                        <td className="px-8 py-5 text-right">
                          <div className="flex justify-end gap-1 opacity-60 group-hover:opacity-100 transition-all">
                            {c.phone && <a href={`https://wa.me/${c.phone}`} target="_blank" rel="noreferrer" className="text-emerald-400 p-3 hover:bg-emerald-500/10 rounded-2xl transition-all"><i className="fab fa-whatsapp"></i></a>}
                            <button onClick={() => setEditContact(c)} className="text-blue-400 p-3 hover:bg-blue-500/10 rounded-2xl transition-all"><i className="fas fa-edit"></i></button>
                            <button onClick={() => deleteContact(c.id)} className="text-rose-500 p-3 hover:bg-rose-500/10 rounded-2xl transition-all"><i className="fas fa-trash"></i></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* VISTA TINDER (REVISIÓN RÁPIDA) */}
            {viewMode === 'tinder' && filteredContacts[tinderIndex] && (
              <div className="flex flex-col items-center max-w-sm mx-auto pt-6 animate-fadeIn">
                <div className={`w-full bg-slate-800 p-10 rounded-[3.5rem] border-t-[16px] ${STATUS_CONFIG[filteredContacts[tinderIndex].status].borderColor} shadow-[0_30px_100px_rgba(0,0,0,0.5)] relative`}>
                  <div className="absolute top-8 right-10 text-slate-600 font-black text-xs tracking-widest">{tinderIndex + 1} / {filteredContacts.length}</div>
                  
                  <div className="mb-12 text-center">
                    <h2 className="text-4xl font-black break-words leading-none mb-4 text-white uppercase tracking-tighter">{filteredContacts[tinderIndex]?.name}</h2>
                    <span className="bg-slate-700 text-slate-300 text-[10px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest border border-slate-600">{filteredContacts[tinderIndex]?.origin}</span>
                  </div>

                  <div className="bg-slate-900/80 p-8 rounded-3xl mb-12 border border-slate-700 text-center shadow-inner">
                    <p className="text-[10px] font-black text-slate-500 uppercase mb-2 tracking-[0.2em]">WhatsApp Contact</p>
                    <p className="text-3xl font-mono text-blue-400 tracking-widest font-black leading-none">{filteredContacts[tinderIndex]?.phone || 'SIN NÚMERO'}</p>
                  </div>

                  {filteredContacts[tinderIndex]?.phone && (
                    <a 
                      href={`https://wa.me/${filteredContacts[tinderIndex].phone}`} 
                      target="_blank" 
                      rel="noreferrer"
                      className="w-full bg-emerald-600 py-6 rounded-[2rem] font-black text-xl mb-8 flex items-center justify-center gap-4 active:scale-90 transition-all shadow-2xl shadow-emerald-900/40 text-white"
                    >
                      <i className="fab fa-whatsapp text-4xl"></i> ABRIR CHAT
                    </a>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <button 
                      onClick={() => { handleStatusChange(filteredContacts[tinderIndex].id, ContactStatus.JUGANDO); setTinderIndex(i => (i + 1) % filteredContacts.length); }} 
                      className="bg-purple-600 py-6 rounded-2xl font-black text-xs active:scale-95 transition-all shadow-lg hover:bg-purple-500 uppercase"
                    >
                      JUGANDO
                    </button>
                    <button 
                      onClick={() => { handleStatusChange(filteredContacts[tinderIndex].id, ContactStatus.CONTACTADO); setTinderIndex(i => (i + 1) % filteredContacts.length); }} 
                      className="bg-emerald-500 py-6 rounded-2xl font-black text-xs active:scale-95 transition-all shadow-lg hover:bg-emerald-400 uppercase"
                    >
                      CONTACTADO
                    </button>
                    <button 
                      onClick={() => { handleStatusChange(filteredContacts[tinderIndex].id, ContactStatus.NO_INTERESADO); setTinderIndex(i => (i + 1) % filteredContacts.length); }} 
                      className="bg-rose-500 py-6 rounded-2xl font-black text-xs active:scale-95 transition-all shadow-lg hover:bg-rose-400 uppercase text-white"
                    >
                      NO INTERÉS
                    </button>
                    <button 
                      onClick={() => { handleStatusChange(filteredContacts[tinderIndex].id, ContactStatus.SIN_WSP); setTinderIndex(i => (i + 1) % filteredContacts.length); }} 
                      className="bg-slate-600 py-6 rounded-2xl font-black text-xs active:scale-95 transition-all shadow-lg hover:bg-slate-500 uppercase"
                    >
                      SIN WSP
                    </button>
                  </div>

                  <div className="flex justify-between mt-12 text-slate-500 font-black text-[10px] uppercase pt-8 border-t border-slate-700/50">
                    <button disabled={tinderIndex === 0} onClick={() => setTinderIndex(i => i - 1)} className="disabled:opacity-20 flex items-center gap-3 px-6 py-3 hover:text-white transition-all"><i className="fas fa-arrow-left"></i> Anterior</button>
                    <button onClick={() => setTinderIndex(i => (i + 1) % filteredContacts.length)} className="flex items-center gap-3 px-6 py-3 hover:text-white transition-all">Siguiente <i className="fas fa-arrow-right"></i></button>
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
          <div className="relative bg-slate-800 border border-slate-700 p-8 md:p-12 rounded-[4rem] w-full max-w-md shadow-3xl animate-slideUp">
            <h2 className="text-4xl font-black mb-10 text-center uppercase tracking-tighter text-white">Importar Datos</h2>
            <div className="space-y-6">
              <div className="relative border-4 border-dashed border-slate-700 p-12 rounded-[2.5rem] hover:border-blue-500 text-center cursor-pointer transition-all group overflow-hidden bg-slate-900/30">
                <input type="file" accept=".csv" onChange={e => handleFileImport(e, 'csv')} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
                <div className="group-hover:scale-110 transition-transform duration-300">
                  <i className="fas fa-file-csv text-6xl text-blue-400 mb-4"></i>
                  <p className="font-black text-white uppercase text-sm">Planilla Sheets</p>
                  <p className="text-[10px] text-slate-500 font-bold mt-2 uppercase tracking-widest italic">Sincroniza Estados</p>
                </div>
              </div>
              <div className="relative border-4 border-dashed border-slate-700 p-12 rounded-[2.5rem] hover:border-emerald-500 text-center cursor-pointer transition-all group overflow-hidden bg-slate-900/30">
                <input type="file" accept=".vcf,.vcard" onChange={e => handleFileImport(e, 'vcf')} className="absolute inset-0 opacity-0 cursor-pointer z-10" />
                <div className="group-hover:scale-110 transition-transform duration-300">
                  <i className="fas fa-address-book text-6xl text-emerald-400 mb-4"></i>
                  <p className="font-black text-white uppercase text-sm">Agenda VCF</p>
                  <p className="text-[10px] text-slate-500 font-bold mt-2 uppercase tracking-widest italic">Carga Números</p>
                </div>
              </div>
            </div>
            <button onClick={() => setIsImportOpen(false)} className="w-full mt-10 py-5 font-black text-slate-500 uppercase text-xs hover:text-white transition-colors tracking-[0.3em]">Cerrar</button>
          </div>
        </div>
      )}

      {/* MODAL EDICIÓN PERFIL */}
      {editContact && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md animate-fadeIn" onClick={() => setEditContact(null)}></div>
          <form onSubmit={handleSaveEdit} className="relative bg-slate-800 border border-slate-700 p-10 md:p-12 rounded-[4rem] w-full max-w-md shadow-3xl animate-slideUp">
            <h2 className="text-4xl font-black mb-10 uppercase tracking-tighter text-white">Editar Perfil</h2>
            <div className="space-y-8">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase block mb-3 px-2 tracking-widest">Nombre / Usuario</label>
                <input 
                  required 
                  type="text" 
                  value={editContact.name} 
                  onChange={e => setEditContact({...editContact, name: e.target.value})} 
                  className="w-full bg-slate-900 border border-slate-700 p-6 rounded-3xl focus:ring-4 focus:ring-blue-500/20 outline-none font-black text-white text-xl transition-all shadow-inner" 
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase block mb-3 px-2 tracking-widest">Número WhatsApp</label>
                <input 
                  type="text" 
                  value={editContact.phone} 
                  onChange={e => setEditContact({...editContact, phone: e.target.value.replace(/\D/g,'')})} 
                  className="w-full bg-slate-900 border border-slate-700 p-6 rounded-3xl focus:ring-4 focus:ring-blue-500/20 outline-none font-mono text-blue-400 text-2xl transition-all shadow-inner" 
                  placeholder="Ej: 549351..." 
                />
              </div>
            </div>
            <div className="flex gap-4 mt-12">
              <button type="button" onClick={() => setEditContact(null)} className="flex-1 py-6 font-black text-slate-500 uppercase text-xs hover:bg-slate-700/50 rounded-3xl transition-all">Cancelar</button>
              <button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-500 py-6 rounded-3xl font-black uppercase text-xs shadow-xl shadow-blue-900/30 transition-all active:scale-90 text-white">Guardar</button>
            </div>
          </form>
        </div>
      )}

      {/* BOTÓN FLOTANTE TINDER (MOBILE ONLY) */}
      {contacts.length > 0 && viewMode !== 'tinder' && (
        <button 
          onClick={() => { setViewMode('tinder'); setTinderIndex(0); }} 
          className="md:hidden fixed bottom-10 right-10 w-24 h-24 bg-gradient-to-br from-rose-600 to-rose-700 rounded-full flex items-center justify-center text-white shadow-[0_20px_60px_rgba(225,29,72,0.5)] z-40 border-[8px] border-[#0f172a] active:scale-75 transition-all"
        >
          <i className="fas fa-fire text-4xl"></i>
        </button>
      )}
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
