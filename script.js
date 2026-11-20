/* =====================================================
   GERENCIADOR DE TAREFAS — lógica (JavaScript puro)
   Persistência: LocalStorage (JSON estruturado)
   ===================================================== */
(() => {
  'use strict';

  /* ---------- Constantes ---------- */
  const STORAGE_KEY = 'gerenciador-tarefas.v1';
  const COLUNAS = ['entrada', 'foco', 'concluido'];
  const CATEGORIAS = {
    trabalho: 'Trabalho',
    pessoal: 'Pessoal',
    estudos: 'Estudos',
    saude: 'Saúde',
    financas: 'Finanças',
  };
  const MS_DIA = 86400000;

  /* ---------- Atalhos de DOM ---------- */
  const $ = (sel) => document.querySelector(sel);
  const slider = $('#slider');
  const viewport = $('#viewport');
  const overlay = $('#overlay');
  const form = $('#form-tarefa');

  /* ---------- Estado em memória ---------- */
  let tarefas = carregar();
  let abaAtual = 0;
  const expandidos = new Set();   // ids de cards abertos (sobrevive a re-renderizações)
  let editandoId = null;          // null = criando nova tarefa
  let refocarSub = null;          // id do card cujo input de subtarefa deve recuperar o foco

  /* =====================================================
     DADOS (LocalStorage)
     Estrutura de cada tarefa:
     { id, titulo, categoria, status, statusAnterior, prazo ('YYYY-MM-DD' | ''),
       subtarefas: [{ id, texto, feito }], criadaEm, concluidaEm }
     ===================================================== */
  function uid() {
    return (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function novaTarefa(titulo, categoria, status, prazo, subs) {
    return {
      id: uid(),
      titulo,
      categoria,
      status,
      statusAnterior: status === 'concluido' ? 'entrada' : status,
      prazo: prazo || '',
      subtarefas: (subs || []).map((texto) => ({ id: uid(), texto, feito: false })),
      criadaEm: Date.now(),
      concluidaEm: null,
    };
  }

  function carregar() {
    try {
      const bruto = localStorage.getItem(STORAGE_KEY);
      if (bruto === null) return exemplos();            // primeiro acesso
      const dados = JSON.parse(bruto);
      if (!Array.isArray(dados)) return [];
      // saneamento básico para tolerar dados antigos/corrompidos
      return dados
        .filter((t) => t && typeof t.titulo === 'string')
        .map((t) => ({
          id: t.id || uid(),
          titulo: t.titulo,
          categoria: CATEGORIAS[t.categoria] ? t.categoria : 'pessoal',
          status: COLUNAS.includes(t.status) ? t.status : 'entrada',
          statusAnterior: COLUNAS.includes(t.statusAnterior) ? t.statusAnterior : 'entrada',
          prazo: t.prazo || '',
          subtarefas: Array.isArray(t.subtarefas)
            ? t.subtarefas.map((s) => ({ id: s.id || uid(), texto: String(s.texto || ''), feito: !!s.feito }))
            : [],
          criadaEm: t.criadaEm || Date.now(),
          concluidaEm: t.concluidaEm || null,
        }));
    } catch (e) {
      return [];
    }
  }

  function salvar() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tarefas));
    } catch (e) {
      /* modo privado / cota cheia: o app continua funcionando em memória */
    }
  }

  function exemplos() {
    const em = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
    return [
      novaTarefa('Enviar relatório semanal', 'trabalho', 'foco', em(0), ['Revisar números', 'Anexar gráficos', 'Enviar ao gestor']),
      novaTarefa('Comprar presente de aniversário', 'pessoal', 'entrada', em(1), []),
      novaTarefa('Ler capítulo 4', 'estudos', 'entrada', em(5), ['Fazer resumo']),
    ];
  }

  /* =====================================================
     DATAS
     ===================================================== */
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  function inicioDoDia() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /** Dias de diferença entre o prazo e hoje (negativo = atrasado). */
  function diasAte(prazo) {
    const [y, m, d] = prazo.split('-').map(Number);
    return Math.round((new Date(y, m - 1, d) - inicioDoDia()) / MS_DIA);
  }

  function formatarData(prazo) {
    const [, m, d] = prazo.split('-');
    return `${d}/${m}`;
  }

  /** Alerta visual do prazo, comparando com a data atual do dispositivo. */
  function infoPrazo(t) {
    if (!t.prazo) return null;
    if (t.status === 'concluido') return { cls: 'gray', txt: formatarData(t.prazo) };
    const dias = diasAte(t.prazo);
    if (dias < 0) return { cls: 'red', txt: 'Atrasada' };      // #ff3b30
    if (dias === 0) return { cls: 'red', txt: 'Hoje' };          // #ff3b30
    if (dias === 1) return { cls: 'orange', txt: 'Amanhã' };     // #ff9500
    return { cls: 'gray', txt: formatarData(t.prazo) };          // #8e8e93
  }

  /* =====================================================
     UTILITÁRIOS DE DOM (sem innerHTML => sem XSS)
     ===================================================== */
  function el(tag, attrs, ...filhos) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const f of filhos) if (f) n.append(f);
    return n;
  }

  function svg(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }

  const ICON_CHECK = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.3l2.4 2.4 4.6-5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON_CHEV = '<svg class="chev" width="10" height="16" viewBox="0 0 10 16" aria-hidden="true"><path d="M2 2l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON_X = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  /* =====================================================
     RENDERIZAÇÃO
     ===================================================== */
  function montarCard(t) {
    const feitas = t.subtarefas.filter((s) => s.feito).length;
    const aberto = expandidos.has(t.id);
    const prazo = infoPrazo(t);

    const meta = el('div', { class: 'card-meta' },
      el('span', { class: 'tag', 'data-cat': t.categoria, text: CATEGORIAS[t.categoria] }),
      prazo && el('span', { class: `badge ${prazo.cls}`, text: prazo.txt }),
      t.subtarefas.length > 0 && el('span', { class: 'subcount', text: `${feitas}/${t.subtarefas.length}` })
    );

    const check = el('button', {
      class: 'check', type: 'button', 'data-action': 'check',
      'aria-label': t.status === 'concluido' ? 'Reabrir tarefa' : 'Concluir tarefa',
    }, el('span', { class: 'check-circle' }, svg(ICON_CHECK)));

    const main = el('div', { class: 'card-main', role: 'button', tabindex: '0', 'aria-expanded': String(aberto) },
      check,
      el('div', { class: 'card-body' }, el('div', { class: 'card-title', text: t.titulo }), meta),
      svg(ICON_CHEV)
    );

    /* Subtarefas */
    const lista = el('div', { class: 'subs' });
    for (const s of t.subtarefas) {
      lista.append(el('div', { class: 'sub' + (s.feito ? ' feito' : ''), 'data-sid': s.id },
        el('button', { class: 'check', type: 'button', 'data-action': 'sub-check', 'data-sid': s.id, 'aria-label': 'Marcar subtarefa' },
          el('span', { class: 'check-circle' }, svg(ICON_CHECK))),
        el('span', { class: 'sub-text', text: s.texto }),
        el('button', { class: 'sub-del', type: 'button', 'data-action': 'sub-del', 'data-sid': s.id, 'aria-label': 'Remover subtarefa' }, svg(ICON_X))
      ));
    }

    const addForm = el('form', { class: 'sub-add', autocomplete: 'off' },
      el('input', { type: 'text', placeholder: 'Nova subtarefa…', maxlength: '120', enterkeyhint: 'done', 'aria-label': 'Nova subtarefa' })
    );

    const acoes = el('div', { class: 'actions' });
    if (t.status === 'entrada') acoes.append(el('button', { class: 'act', type: 'button', 'data-action': 'move', 'data-to': 'foco', text: 'Mover p/ Foco' }));
    if (t.status === 'foco') acoes.append(el('button', { class: 'act', type: 'button', 'data-action': 'move', 'data-to': 'entrada', text: 'Voltar p/ Entrada' }));
    acoes.append(
      el('button', { class: 'act', type: 'button', 'data-action': 'edit', text: 'Editar' }),
      el('button', { class: 'act danger', type: 'button', 'data-action': 'delete', text: 'Excluir' })
    );

    const extra = el('div', { class: 'card-extra' },
      el('div', { class: 'card-extra-inner' }, el('div', { class: 'extra-pad' }, lista, addForm, acoes))
    );

    return el('article', { class: 'card' + (t.status === 'concluido' ? ' done' : '') + (aberto ? ' open' : ''), 'data-id': t.id }, main, extra);
  }

  function ordenar(lista, status) {
    return lista.slice().sort((a, b) => {
      if (status === 'concluido') return (b.concluidaEm || 0) - (a.concluidaEm || 0);
      if (a.prazo && b.prazo && a.prazo !== b.prazo) return a.prazo < b.prazo ? -1 : 1;
      if (a.prazo && !b.prazo) return -1;
      if (!a.prazo && b.prazo) return 1;
      return a.criadaEm - b.criadaEm;
    });
  }

  function renderizar() {
    for (const status of COLUNAS) {
      const itens = ordenar(tarefas.filter((t) => t.status === status), status);
      const frag = document.createDocumentFragment();
      itens.forEach((t) => frag.append(montarCard(t)));
      $(`#list-${status}`).replaceChildren(frag);
      $(`#empty-${status}`).hidden = itens.length > 0;
      $(`#count-${status}`).textContent = itens.length;
    }
    $('#toolbar-concluido').hidden = !tarefas.some((t) => t.status === 'concluido');
    atualizarCabecalho();

    if (refocarSub) {
      const input = document.querySelector(`.card[data-id="${refocarSub}"] .sub-add input`);
      if (input) input.focus();
      refocarSub = null;
    }
  }

  /* ---------- Cabeçalho: data + anel de progresso ----------
     "Do dia" = concluídas hoje  +  pendentes que estão em Foco ou vencem hoje/atrasadas. */
  function atualizarCabecalho() {
    const hoje = new Date();
    const texto = hoje.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    $('#data-hoje').textContent = texto.charAt(0).toUpperCase() + texto.slice(1);

    const inicio = inicioDoDia().getTime();
    let feitas = 0;
    let pendentes = 0;
    for (const t of tarefas) {
      if (t.status === 'concluido') {
        if (t.concluidaEm && t.concluidaEm >= inicio) feitas++;
      } else if (t.status === 'foco' || (t.prazo && diasAte(t.prazo) <= 0)) {
        pendentes++;
      }
    }
    const total = feitas + pendentes;
    const pct = total ? feitas / total : 0;

    $('#ring-bar').style.strokeDashoffset = String(138.23 * (1 - pct));
    $('#ring-label').textContent = total ? `${Math.round(pct * 100)}%` : '–';
    $('#ring').setAttribute('aria-label', total ? `${feitas} de ${total} tarefas do dia concluídas` : 'Sem tarefas para hoje');
    $('#resumo').textContent = total
      ? `${feitas} de ${total} concluída${total > 1 ? 's' : ''} hoje`
      : 'Nada marcado para hoje';
  }

  /* =====================================================
     AÇÕES
     ===================================================== */
  const achar = (id) => tarefas.find((t) => t.id === id);

  function alternarConcluida(t) {
    if (t.status !== 'concluido') {
      t.statusAnterior = t.status;
      t.status = 'concluido';
      t.concluidaEm = Date.now();
    } else {
      t.status = t.statusAnterior || 'entrada';
      t.concluidaEm = null;
    }
  }

  function tratarAcao(acao, id, btn) {
    const t = achar(id);
    if (!t) return;

    switch (acao) {
      case 'check':
        alternarConcluida(t);
        break;
      case 'sub-check': {
        const s = t.subtarefas.find((x) => x.id === btn.dataset.sid);
        if (s) s.feito = !s.feito;
        break;
      }
      case 'sub-del':
        t.subtarefas = t.subtarefas.filter((x) => x.id !== btn.dataset.sid);
        break;
      case 'move':
        t.status = btn.dataset.to;
        t.statusAnterior = t.status;
        break;
      case 'edit':
        abrirFolha(t);
        return;
      case 'delete':
        if (!window.confirm('Excluir esta tarefa?')) return;
        tarefas = tarefas.filter((x) => x.id !== id);
        expandidos.delete(id);
        break;
    }
    salvar();
    renderizar();
  }

  function alternarExpansao(card) {
    const id = card.dataset.id;
    const aberto = card.classList.toggle('open');
    aberto ? expandidos.add(id) : expandidos.delete(id);
    card.querySelector('.card-main').setAttribute('aria-expanded', String(aberto));
  }

  /* Delegação de eventos: um único listener para todos os cards */
  slider.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const btn = e.target.closest('[data-action]');
    if (btn) { tratarAcao(btn.dataset.action, card.dataset.id, btn); return; }
    if (e.target.closest('.card-main')) alternarExpansao(card);
  });

  slider.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('card-main')) {
      e.preventDefault();
      alternarExpansao(e.target.closest('.card'));
    }
  });

  /* Adicionar subtarefa pelo campo dentro do card */
  slider.addEventListener('submit', (e) => {
    e.preventDefault();
    const formSub = e.target.closest('.sub-add');
    if (!formSub) return;
    const card = formSub.closest('.card');
    const input = formSub.querySelector('input');
    const texto = input.value.trim();
    const t = achar(card.dataset.id);
    if (!t || !texto) return;
    t.subtarefas.push({ id: uid(), texto, feito: false });
    refocarSub = t.id;
    salvar();
    renderizar();
  });

  /* ---------- Limpar concluídas (com confirmação nativa + fade-out) ---------- */
  $('#btn-limpar').addEventListener('click', () => {
    const qtd = tarefas.filter((t) => t.status === 'concluido').length;
    if (!qtd) return;
    const msg = `Apagar permanentemente ${qtd} tarefa${qtd > 1 ? 's' : ''} concluída${qtd > 1 ? 's' : ''}?`;
    if (!window.confirm(msg)) return;

    document.querySelectorAll('#list-concluido .card').forEach((c) => c.classList.add('fade-out'));
    setTimeout(() => {
      tarefas = tarefas.filter((t) => t.status !== 'concluido');   // só as concluídas
      salvar();
      renderizar();
    }, 320);
  });

  /* =====================================================
     ABAS + SWIPE
     ===================================================== */
  function irParaAba(i) {
    abaAtual = Math.max(0, Math.min(COLUNAS.length - 1, i));
    slider.style.transform = `translateX(${-abaAtual * (100 / 3)}%)`;
    $('#tab-indicator').style.transform = `translateX(${abaAtual * 100}%)`;
    document.querySelectorAll('.tab').forEach((b, idx) => {
      b.classList.toggle('active', idx === abaAtual);
      b.setAttribute('aria-selected', String(idx === abaAtual));
    });
  }

  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (b) irParaAba(Number(b.dataset.tab));
  });

  let sx = 0, sy = 0, rastreando = false;
  viewport.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || e.target.closest('input, textarea, select')) { rastreando = false; return; }
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    rastreando = true;
  }, { passive: true });

  viewport.addEventListener('touchend', (e) => {
    if (!rastreando) return;
    rastreando = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx;
    const dy = t.clientY - sy;
    // gesto predominantemente horizontal e longo o bastante
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      irParaAba(abaAtual + (dx < 0 ? 1 : -1));
    }
  }, { passive: true });

  /* =====================================================
     FOLHA MODAL (criar / editar)
     ===================================================== */
  const selCategoria = $('#f-categoria');
  for (const [valor, nome] of Object.entries(CATEGORIAS)) {
    selCategoria.append(el('option', { value: valor, text: nome }));
  }

  function abrirFolha(t) {
    editandoId = t ? t.id : null;
    $('#sheet-titulo').textContent = t ? 'Editar tarefa' : 'Nova tarefa';
    $('#f-titulo').value = t ? t.titulo : '';
    selCategoria.value = t ? t.categoria : 'trabalho';
    $('#f-status').value = t && t.status !== 'concluido' ? t.status : (t ? 'entrada' : (abaAtual === 1 ? 'foco' : 'entrada'));
    $('#f-status').disabled = !!(t && t.status === 'concluido');
    $('#f-prazo').value = t ? t.prazo : '';
    $('#f-subs').value = t ? t.subtarefas.map((s) => s.texto).join('\n') : '';
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
  }

  function fecharFolha() {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.activeElement && document.activeElement.blur();
  }

  $('#fab').addEventListener('click', () => abrirFolha(null));
  $('#btn-cancelar').addEventListener('click', fecharFolha);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) fecharFolha(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharFolha(); });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const titulo = $('#f-titulo').value.trim();
    if (!titulo) { $('#f-titulo').focus(); return; }

    const linhas = $('#f-subs').value.split('\n').map((l) => l.trim()).filter(Boolean);
    const dados = {
      titulo,
      categoria: selCategoria.value,
      prazo: $('#f-prazo').value,
    };

    if (editandoId) {
      const t = achar(editandoId);
      if (t) {
        Object.assign(t, dados);
        if (t.status !== 'concluido') { t.status = $('#f-status').value; t.statusAnterior = t.status; }
        // reaproveita subtarefas existentes com o mesmo texto (preserva o "feito")
        const antigas = [...t.subtarefas];
        t.subtarefas = linhas.map((texto) => {
          const i = antigas.findIndex((s) => s.texto === texto);
          return i >= 0 ? antigas.splice(i, 1)[0] : { id: uid(), texto, feito: false };
        });
      }
    } else {
      tarefas.push(novaTarefa(dados.titulo, dados.categoria, $('#f-status').value, dados.prazo, linhas));
      irParaAba($('#f-status').value === 'foco' ? 1 : 0);
    }

    salvar();
    renderizar();
    fecharFolha();
  });

  /* =====================================================
     INICIALIZAÇÃO
     ===================================================== */
  // Atualiza data/alertas ao voltar para o app e a cada minuto (virada de dia)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderizar(); });
  setInterval(renderizar, 60000);

  salvar();       // grava os exemplos no primeiro acesso
  renderizar();
  irParaAba(0);

  // Service Worker (PWA offline) — só em http(s)
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
