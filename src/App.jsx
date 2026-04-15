import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, UserPlus, Trash2, ArrowLeft, CheckCircle2, 
  Circle, Edit2, RotateCcw, DollarSign, Calendar, FileText, ChevronRight, Info
} from 'lucide-react';

/**
 * 1. 本地存儲邏輯 (取代 Firebase)
 * 為什麼：在大 T 邏輯中，先確保「功能可見」比「雲端同步」重要。
 * 我們使用 localStorage 來確保你重新整理頁面後，資料依然存在。
 */
const STORAGE_KEYS = {
  USERS: 'AAApp_users',
  PROJECTS: 'AAApp_projects',
  EXPENSES: 'AAApp_expenses'
};

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
const PAGES = { HOME: 'home', USER_EDIT: 'user_edit', PROJECT_DETAIL: 'project_detail', TRASH: 'trash' };

const App = () => {
  // --- 狀態管理 ---
  const [currentPage, setCurrentPage] = useState(PAGES.HOME);
  const [currentProjectId, setCurrentProjectId] = useState(null);
  
  // 資料狀態 (從 localStorage 初始化)
  const [globalUsers, setGlobalUsers] = useState(() => JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]'));
  const [projects, setProjects] = useState(() => JSON.parse(localStorage.getItem(STORAGE_KEYS.PROJECT_PROJECTS) || '[]'));
  const [expenses, setExpenses] = useState(() => JSON.parse(localStorage.getItem(STORAGE_KEYS.EXPENSES) || '[]'));
  
  // UI 互動狀態
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState(''); // 'project' | 'expense'
  const [editingItem, setEditingItem] = useState(null);

  // --- 資料持久化 ---
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(globalUsers)); }, [globalUsers]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(projects)); }, [projects]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.EXPENSES, JSON.stringify(expenses)); }, [expenses]);

  /**
   * 2. 分帳核心演算法
   * 邏輯：計算該專案下「未結清」帳目的總額與還債路徑。
   */
  const projectDebts = useMemo(() => {
    if (!currentProjectId) return [];
    const activeExpenses = expenses.filter(e => e.projectId === currentProjectId && !e.deletedAt && !e.settled);
    const balanceMap = {}; 

    activeExpenses.forEach(exp => {
      const amount = parseFloat(exp.amount) || 0;
      const debtors = exp.debtorIds || [];
      if (!debtors.length) return;
      const splitAmt = amount / debtors.length;

      balanceMap[exp.payerId] = (balanceMap[exp.payerId] || 0) + amount;
      debtors.forEach(id => { balanceMap[id] = (balanceMap[id] || 0) - splitAmt; });
    });

    const creditors = [], debtorsArr = [];
    Object.keys(balanceMap).forEach(uid => {
      if (balanceMap[uid] > 0.1) creditors.push({ uid, amt: balanceMap[uid] });
      else if (balanceMap[uid] < -0.1) debtorsArr.push({ uid, amt: Math.abs(balanceMap[uid]) });
    });

    const detailed = [];
    let ci = 0, di = 0;
    while (ci < creditors.length && di < debtorsArr.length) {
      const pay = Math.min(creditors[ci].amt, debtorsArr[di].amt);
      detailed.push({ from: debtorsArr[di].uid, to: creditors[ci].uid, amount: pay.toFixed(0) });
      creditors[ci].amt -= pay; debtorsArr[di].amt -= pay;
      if (creditors[ci].amt < 0.1) ci++;
      if (debtorsArr[di].amt < 0.1) di++;
    }
    return detailed;
  }, [expenses, currentProjectId]);

  // --- 資料操作 ---
  const handleAction = (type, id, action) => {
    const setters = { user: setGlobalUsers, project: setProjects, expense: setExpenses };
    const lists = { user: globalUsers, project: projects, expense: expenses };
    
    if (action === 'soft') {
      setters[type](lists[type].map(i => i.id === id ? { ...i, deletedAt: Date.now() } : i));
    } else if (action === 'restore') {
      setters[type](lists[type].map(i => i.id === id ? { ...i, deletedAt: null } : i));
    } else if (action === 'hard') {
      setters[type](lists[type].filter(i => i.id !== id));
    }
  };

  // --- UI 元件 ---
  const Button = ({ children, onClick, variant = 'primary', className = '', type = "button" }) => {
    const styles = {
      primary: "bg-[#94A7AE] text-white hover:bg-[#83969D]",
      secondary: "bg-[#E5E1DA] text-[#6B7280] hover:bg-[#D7D2C8]",
      outline: "border-2 border-[#94A7AE] text-[#94A7AE] hover:bg-[#F0F4F5]",
      danger: "bg-[#C0A0A0] text-white hover:bg-[#B08F8F]"
    };
    return <button type={type} onClick={onClick} className={`px-4 py-2 rounded-xl transition-all active:scale-95 flex items-center justify-center gap-2 font-medium shadow-sm ${styles[variant]} ${className}`}>{children}</button>;
  };

  // --- 頁面渲染 ---
  const renderHome = () => (
    <div className="space-y-6">
      <header className="flex justify-between items-center">
        <h1 className="text-3xl font-serif text-[#5B6D72]">日常分帳</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setCurrentPage(PAGES.TRASH)}><Trash2 size={18}/></Button>
          <Button onClick={() => { setModalType('project'); setEditingItem(null); setIsModalOpen(true); }}><Plus size={18}/> 新專案</Button>
        </div>
      </header>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {projects.filter(p => !p.deletedAt).map(p => (
          <div key={p.id} onClick={() => { setCurrentProjectId(p.id); setCurrentPage(PAGES.PROJECT_DETAIL); }}
               className="bg-white p-6 rounded-3xl border border-[#F0EBE3] group hover:border-[#94A7AE] transition-all cursor-pointer">
            <div className="flex justify-between items-start mb-3">
              <h3 className="text-xl font-medium text-[#6B7280] group-hover:text-[#5B6D72]">{p.name}</h3>
              <div className="flex gap-2 opacity-0 group-hover:opacity-100">
                <button onClick={(e) => { e.stopPropagation(); setEditingItem(p); setModalType('project'); setIsModalOpen(true); }} className="text-[#94A7AE]"><Edit2 size={16}/></button>
                <button onClick={(e) => { e.stopPropagation(); handleAction('project', p.id, 'soft'); }} className="text-[#C0A0A0]"><Trash2 size={16}/></button>
              </div>
            </div>
            <p className="text-xs text-[#A3A3A3] flex items-center gap-1"><UserPlus size={14}/> {p.userIds?.length || 0} 位成員</p>
          </div>
        ))}
      </div>
      <Button variant="outline" className="w-full py-6 border-dashed border-2 rounded-3xl" onClick={() => setCurrentPage(PAGES.USER_EDIT)}>
        <UserPlus size={20} /> 管理常用成員
      </Button>
    </div>
  );

  const renderUserEdit = () => (
    <div className="space-y-6">
      <header className="flex items-center gap-4">
        <Button variant="secondary" onClick={() => setCurrentPage(PAGES.HOME)} className="p-2 rounded-full"><ArrowLeft size={20}/></Button>
        <h1 className="text-2xl font-serif text-[#5B6D72]">成員編輯</h1>
      </header>
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-[#F0EBE3] space-y-4">
        <div className="flex gap-2">
          <input id="userNameInput" placeholder="輸入成員姓名..." className="flex-1 bg-gray-50 border-none rounded-xl px-4 py-2 outline-none focus:ring-2 focus:ring-[#94A7AE]" />
          <Button onClick={() => {
            const input = document.getElementById('userNameInput');
            if (!input.value) return;
            setGlobalUsers([...globalUsers, { id: Date.now().toString(), name: input.value, deletedAt: null }]);
            input.value = '';
          }}>新增</Button>
        </div>
        <div className="divide-y divide-gray-100">
          {globalUsers.filter(u => !u.deletedAt).map(u => (
            <div key={u.id} className="py-3 flex justify-between items-center group">
              <span className="text-[#6B7280]">{u.name}</span>
              <button onClick={() => handleAction('user', u.id, 'soft')} className="text-[#C0A0A0] opacity-0 group-hover:opacity-100"><Trash2 size={18}/></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderProjectDetail = () => {
    const project = projects.find(p => p.id === currentProjectId);
    if (!project) return null;
    const projectExpenses = expenses.filter(e => e.projectId === currentProjectId && !e.deletedAt);
    return (
      <div className="space-y-6">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="secondary" onClick={() => setCurrentPage(PAGES.HOME)} className="p-2 rounded-full"><ArrowLeft size={20}/></Button>
            <h1 className="text-2xl font-serif text-[#5B6D72]">{project.name}</h1>
          </div>
          <Button onClick={() => { setModalType('expense'); setEditingItem(null); setIsModalOpen(true); }}><Plus size={18}/> 記一筆</Button>
        </header>
        <div className="bg-[#F0F4F5] rounded-3xl p-6 border border-[#DCE4E6] space-y-4">
          <h3 className="text-[10px] font-bold text-[#83969D] tracking-widest uppercase">債務分析</h3>
          {projectDebts.length > 0 ? projectDebts.map((d, i) => (
            <div key={i} className="flex items-center justify-between text-sm text-[#5B6D72]">
              <span className="bg-white px-3 py-1 rounded-lg shadow-sm">{globalUsers.find(u => u.id === d.from)?.name}</span>
              <div className="flex-1 border-b-2 border-dashed border-[#BDC9CD] mx-4 relative">
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#F0F4F5] px-2 text-xs font-bold text-[#94A7AE]">${d.amount}</span>
              </div>
              <span className="bg-white px-3 py-1 rounded-lg shadow-sm">{globalUsers.find(u => u.id === d.to)?.name}</span>
            </div>
          )) : <p className="text-center text-[#A3A3A3] italic py-2 text-sm">目前帳務已清清囉！</p>}
        </div>
        <div className="space-y-3">
          {projectExpenses.sort((a,b) => b.date?.localeCompare(a.date)).map(exp => (
            <div key={exp.id} className={`p-4 rounded-2xl border transition-all ${exp.settled ? 'bg-gray-50 opacity-40 grayscale' : 'bg-white shadow-sm hover:border-[#94A7AE]'}`}>
              <div className="flex items-center gap-4">
                <button onClick={() => setExpenses(expenses.map(e => e.id === exp.id ? { ...e, settled: !e.settled } : e))}>
                  {exp.settled ? <CheckCircle2 className="text-[#94A7AE]" /> : <Circle className="text-gray-300" />}
                </button>
                <div className="flex-1" onClick={() => !exp.settled && (setEditingItem(exp), setModalType('expense'), setIsModalOpen(true))}>
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-medium text-[#6B7280]">{exp.name}</h4>
                      <p className="text-[10px] text-[#A3A3A3] mt-1 flex gap-3">
                        <span>{exp.date}</span>
                        <span>{globalUsers.find(u => u.id === exp.payerId)?.name} 付</span>
                      </p>
                    </div>
                    <span className="text-xl font-serif font-bold text-[#5B6D72]">${exp.amount}</span>
                  </div>
                </div>
                {!exp.settled && <button onClick={() => handleAction('expense', exp.id, 'soft')} className="text-[#C0A0A0] hover:scale-110 transition-transform"><Trash2 size={16}/></button>}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderTrash = () => {
    const now = Date.now();
    const trash = [...projects, ...expenses, ...globalUsers].filter(i => i.deletedAt && (now - i.deletedAt < THREE_DAYS_MS));
    return (
      <div className="space-y-6">
        <header className="flex items-center gap-4">
          <Button variant="secondary" onClick={() => setCurrentPage(PAGES.HOME)} className="p-2 rounded-full"><ArrowLeft size={20}/></Button>
          <h1 className="text-2xl font-serif text-[#5B6D72]">資源回收 (3天內)</h1>
        </header>
        <div className="space-y-3">
          {trash.map(item => (
            <div key={item.id} className="bg-white p-4 rounded-2xl border flex justify-between items-center shadow-sm">
              <div>
                <span className="text-[10px] text-[#94A7AE] font-bold uppercase block">{item.amount ? '記帳' : (item.userIds ? '專案' : '成員')}</span>
                <span className="text-[#6B7280]">{item.name || '未命名'}</span>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => handleAction((item.amount ? 'expense' : (item.userIds ? 'project' : 'user')), item.id, 'restore')} className="p-2 rounded-full"><RotateCcw size={16}/></Button>
                <Button variant="secondary" onClick={() => handleAction((item.amount ? 'expense' : (item.userIds ? 'project' : 'user')), item.id, 'hard')} className="p-2 text-[#C0A0A0] rounded-full"><Trash2 size={16}/></Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const Modal = () => {
    if (!isModalOpen) return null;
    const project = projects.find(p => p.id === currentProjectId);
    return (
      <div className="fixed inset-0 bg-[#5B6D72]/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-[#FAF9F6] w-full max-w-md rounded-[2.5rem] shadow-2xl p-8 animate-in zoom-in-95 border border-[#E5E1DA]">
          <form onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const data = Object.fromEntries(fd.entries());
            if (modalType === 'project') {
              const uids = globalUsers.filter(u => !u.deletedAt && fd.get(`u_${u.id}`)).map(u => u.id);
              if (editingItem) setProjects(projects.map(p => p.id === editingItem.id ? { ...p, name: data.name, userIds: uids } : p));
              else setProjects([...projects, { id: Date.now().toString(), name: data.name, userIds: uids, deletedAt: null }]);
            } else {
              const dIds = globalUsers.filter(u => !u.deletedAt && fd.get(`d_${u.id}`)).map(u => u.id);
              const payload = { id: editingItem?.id || Date.now().toString(), projectId: currentProjectId, name: data.name, amount: data.amount, date: data.date, payerId: data.payerId, debtorIds: dIds, notes: data.notes, settled: editingItem?.settled || false, deletedAt: null };
              if (editingItem) setExpenses(expenses.map(e => e.id === editingItem.id ? payload : e));
              else setExpenses([...expenses, payload]);
            }
            setIsModalOpen(false);
          }} className="space-y-5">
            <h2 className="text-2xl font-serif text-[#5B6D72]">{editingItem ? '編輯' : '新增'}{modalType==='project'?'專案':'帳務'}</h2>
            <input required name="name" defaultValue={editingItem?.name} placeholder="名稱" className="w-full bg-white border border-[#E5E1DA] rounded-xl px-4 py-3 outline-none" />
            {modalType === 'project' ? (
              <div className="max-h-40 overflow-y-auto space-y-1 p-2 bg-white rounded-xl border">
                {globalUsers.filter(u => !u.deletedAt).map(u => (
                  <label key={u.id} className="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg cursor-pointer">
                    <input type="checkbox" name={`u_${u.id}`} defaultChecked={editingItem?.userIds?.includes(u.id)} /> {u.name}
                  </label>
                ))}
              </div>
            ) : (
              <>
                <div className="flex gap-3">
                  <input required name="amount" type="number" defaultValue={editingItem?.amount} placeholder="金額" className="w-1/2 bg-white border border-[#E5E1DA] rounded-xl px-4 py-3 outline-none" />
                  <input required name="date" type="date" defaultValue={editingItem?.date || new Date().toISOString().split('T')[0]} className="w-1/2 bg-white border border-[#E5E1DA] rounded-xl px-4 py-3 outline-none" />
                </div>
                <select name="payerId" defaultValue={editingItem?.payerId} className="w-full bg-white border border-[#E5E1DA] rounded-xl px-4 py-3">
                  {globalUsers.filter(u => project?.userIds?.includes(u.id)).map(u => <option key={u.id} value={u.id}>{u.name} 付款</option>)}
                </select>
                <div className="max-h-32 overflow-y-auto grid grid-cols-2 gap-2 p-2 bg-white rounded-xl border">
                  {globalUsers.filter(u => project?.userIds?.includes(u.id)).map(u => (
                    <label key={u.id} className="flex items-center gap-2 text-xs">
                      <input type="checkbox" name={`d_${u.id}`} defaultChecked={editingItem ? editingItem.debtorIds?.includes(u.id) : true} /> {u.name}
                    </label>
                  ))}
                </div>
              </>
            )}
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setIsModalOpen(false)}>取消</Button>
              <Button type="submit" className="flex-1">儲存</Button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#F7F4EF] text-[#444] pb-20 font-sans">
      <div className="max-w-xl mx-auto px-6 py-10">
        {currentPage === PAGES.HOME && renderHome()}
        {currentPage === PAGES.USER_EDIT && renderUserEdit()}
        {currentPage === PAGES.TRASH && renderTrash()}
        {currentPage === PAGES.PROJECT_DETAIL && renderProjectDetail()}
      </div>
      <Modal />
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-[#94A7AE] text-white px-4 py-2 rounded-full text-xs shadow-lg opacity-80">
        <Info size={14} /> 本地執行模式：資料已安全儲存於瀏覽器
      </div>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@600;700&family=Noto+Sans+TC:wght@400;500&display=swap');
        body { font-family: 'Noto Sans TC', sans-serif; }
        .font-serif { font-family: 'Noto Serif TC', serif; }
      `}</style>
    </div>
  );
};

export default App;