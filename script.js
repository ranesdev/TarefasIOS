/* =====================================================
   TAREFAS iOS — lógica (JavaScript puro + LocalStorage)

   Esquema salvo no LocalStorage:
   [{ "id": "1732130000000", "titulo": "...", "status": "foco",
      "categoria": "Trabalho", "prazo": "AAAA-MM-DD",
      "subtarefas": [{ "id": "sub-1", "titulo": "...", "concluida": false }] }]

   Campos extras (usados internamente): "statusAnterior" e "concluidaEm"
   ===================================================== */
(() => {
  'use strict';

  /* ---------- Constantes ---------- */
  const STORAGE_KEY = 'tarefas-ios.v2';
  const STORAGE_KEY_V1 = 'gerenciador-tarefas.v1';   // versão anterior (migração automática)
  const COLUNAS = ['entrada', 'foco', 'concluido'];
  const MS_DIA = 86400000;

  // Cor de cada categoria ("R,G,B") — usada na borda do círculo e na tag
  const CATEGORIAS = [
    { nome: 'Trabalho', cor: '255,69,58' },    // vermelho
    { nome: 'Pessoal',  cor: '10,132,255' },   // azul
    { nome: 'Estudos',  cor: '191,90,242' },   // roxo
    { nome: 'Saúde',    cor: '48,209,88' },    // verde
    { nome: 'Finanças', cor: '255,214,10' },   // amarelo
  ];

  const semAcento = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const corDe = (nome) => (CATEGORIAS.find((c) => c.nome === nome) || CATEGORIAS[1]).cor;
  function categoriaValida(v) {
    const alvo = semAcento(v);
    const c = CATEGORIAS.find((x) => semAcento(x.nome) === alvo);
    return c ? c.nome : 'Pessoal';
  }

  /* ---------- Atalhos de DOM ---------- */
  const $ = (sel) => document.querySelector(sel);
  const slider = $('#slider');
  const viewport = $('#viewport');
  const overlay = $('#overlay');
  const form = $('#form-tarefa');

  /* ---------- Estado ---------- */
  let tarefas = [];               // preenchido na inicialização (fim do arquivo)
  let abaAtual = 0;
  const expandidos = new Set();   // cards abertos (sobrevive a re-renderizações)
  const ocupados = new Set();     // cards aguardando a animação de "concluir"
  let editandoId = null;
  let refocarSub = null;

  /* =====================================================
     DADOS
     ===================================================== */
  function novoId() {
    let id = Date.now();
    while (tarefas && tarefas.some((t) => t.id === String(id))) id++;
    return String(id);
  }

  /** Reatribui ids sequenciais "sub-1", "sub-2"… */
  function renumerar(t) {
    t.subtarefas.forEach((s, i) => { s.id = `sub-${i + 1}`; });
  }

  function novaTarefa(titulo, categoria, status, prazo, subs) {
    const t = {
      id: novoId(),
      titulo,
      status,
      categoria,
      prazo: prazo || '',
      subtarefas: (subs || []).map((texto) => ({ id: '', titulo: texto, concluida: false })),
      statusAnterior: status === 'concluido' ? 'entrada' : status,
      concluidaEm: null,
    };
    renumerar(t);
    return t;
  }

  /** Aceita o esquema novo e o antigo (texto/feito) e devolve o esquema novo. */
  function normalizar(dados) {
    if (!Array.isArray(dados)) return [];
    const usados = new Set();
    return dados
      .filter((t) => t && typeof t.titulo === 'string')
      .map((t, i) => {
        let id = String(t.id || Date.now() + i);
        while (usados.has(id)) id = String(Number(id) + 1);
        usados.add(id);
        const nova = {
          id,
          titulo: t.titulo,
          status: COLUNAS.includes(t.status) ? t.status : 'entrada',
          categoria: categoriaValida(t.categoria),
          prazo: t.prazo || '',
          subtarefas: (Array.isArray(t.subtarefas) ? t.subtarefas : []).map((s) => ({
            id: '',
            titulo: String(s.titulo !== undefined ? s.titulo : (s.texto || '')),
            concluida: !!(s.concluida !== undefined ? s.concluida : s.feito),
          })),
          statusAnterior: COLUNAS.includes(t.statusAnterior) && t.statusAnterior !== 'concluido' ? t.statusAnterior : 'entrada',
          concluidaEm: t.concluidaEm || null,
        };
        renumerar(nova);
        return nova;
      });
  }

  function carregar() {
    try {
      let bruto = localStorage.getItem(STORAGE_KEY);
      if (bruto === null) bruto = localStorage.getItem(STORAGE_KEY_V1);   // migra dados antigos
      if (bruto === null) return exemplos();
      return normalizar(JSON.parse(bruto));
    } catch (e) {
      return [];
    }
  }

  function salvar() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tarefas));
    } catch (e) { /* modo privado / cota cheia: segue em memória */ }
  }

  function exemplos() {
    const em = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
    const lista = [];
    const add = (...args) => { const t = novaTarefa(...args); lista.push(t); tarefas = lista; };
    tarefas = lista;
    add('Enviar relatório semanal', 'Trabalho', 'foco', em(0), ['Revisar números', 'Anexar gráficos', 'Enviar ao gestor']);
    add('Comprar presente de aniversário', 'Pessoal', 'entrada', em(1), []);
    add('Ler capítulo 4', 'Estudos', 'entrada', em(5), ['Fazer resumo']);
    return lista;
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

  /** Dias entre hoje e o prazo (negativo = atrasado), usando a data do aparelho. */
  function diasAte(prazo) {
    const [y, m, d] = prazo.split('-').map(Number);
    return Math.round((new Date(y, m - 1, d) - inicioDoDia()) / MS_DIA);
  }

  const formatarData = (prazo) => { const [, m, d] = prazo.split('-'); return `${d}/${m}`; };

  /** Seleciona a classe CSS e o texto do selo de prazo. */
  function infoPrazo(t) {
    if (!t.prazo) return null;
    if (t.status === 'concluido') return { cls: 'gray', txt: formatarData(t.prazo) };
    const dias = diasAte(t.prazo);
    if (dias < 0) return { cls: 'red', txt: 'Atrasada' };       // #ff3b30
    if (dias === 0) return { cls: 'red', txt: 'Hoje' };          // #ff3b30
    if (dias === 1) return { cls: 'orange', txt: 'Amanhã' };     // #ff9500
    return { cls: 'gray', txt: formatarData(t.prazo) };          // #8e8e93
  }

  /* =====================================================
     DOM (sem innerHTML com dados do usuário => sem XSS)
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
  const ICON_X = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

  /* =====================================================
     RENDERIZAÇÃO
     ===================================================== */
  function textoIndicador(t) {
    const n = t.subtarefas.length;
    if (!n) return 'Sem subtarefas';
    return `${t.subtarefas.filter((s) => s.concluida).length}/${n} subtarefas`;
  }

  function atualizarIndicador(card, t) {
    const txt = card.querySelector('.sub-indicator .txt');
    if (txt) txt.textContent = textoIndicador(t);
  }

  function montarCard(t) {
    const aberto = expandidos.has(t.id);
    const prazo = infoPrazo(t);

    const meta = el('div', { class: 'card-meta' },
      el('span', { class: 'tag', text: t.categoria }),
      prazo && el('span', { class: `badge ${prazo.cls}`, text: prazo.txt })
    );

    const indicador = el('div', { class: 'sub-indicator' },
      el('span', { class: 'arrow', 'aria-hidden': 'true', text: '▼' }),
      el('span', { class: 'txt', text: textoIndicador(t) })
    );

    const check = el('button', {
      class: 'check', type: 'button', 'data-action': 'check',
      'aria-label': t.status === 'concluido' ? 'Reabrir tarefa' : 'Concluir tarefa',
    }, el('span', { class: 'check-circle' }, svg(ICON_CHECK)));

    const main = el('div', { class: 'card-main', role: 'button', tabindex: '0', 'aria-expanded': String(aberto) },
      check,
      el('div', { class: 'card-body' },
        el('div', { class: 'card-title' }, el('span', { class: 't', text: t.titulo })),
        meta,
        indicador
      )
    );

    const lista = el('div', { class: 'subs' });
    for (const s of t.subtarefas) {
      lista.append(el('div', { class: 'sub' + (s.concluida ? ' concluida' : '') },
        el('button', { class: 'check', type: 'button', 'data-action': 'sub-check', 'data-sid': s.id, 'aria-label': 'Marcar subtarefa' },
          el('span', { class: 'check-circle' }, svg(ICON_CHECK))),
        el('span', { class: 'sub-text', text: s.titulo }),
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

    const extra = el('div', { class: 'card-extra', style: aberto ? 'max-height:none' : null },
      el('div', { class: 'extra-pad' }, lista, addForm, acoes)
    );

    return el('article', {
      class: 'card' + (t.status === 'concluido' ? ' done' : '') + (aberto ? ' open' : ''),
      'data-id': t.id,
      style: `--c: ${corDe(t.categoria)}`,
    }, main, extra);
  }

  function ordenar(lista, status) {
    return lista.slice().sort((a, b) => {
      if (status === 'concluido') return (b.concluidaEm || 0) - (a.concluidaEm || 0);
      if (a.prazo && b.prazo && a.prazo !== b.prazo) return a.prazo < b.prazo ? -1 : 1;
      if (a.prazo && !b.prazo) return -1;
      if (!a.prazo && b.prazo) return 1;
      return Number(a.id) - Number(b.id);
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

  /* Cabeçalho: data + anel.
     "Do dia" = concluídas hoje + pendentes em Foco ou com prazo hoje/atrasado. */
  function atualizarCabecalho() {
    const texto = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    $('#data-hoje').textContent = texto;   // a caixa alta vem do CSS (text-transform)

    const inicio = inicioDoDia().getTime();
    let feitas = 0, pendentes = 0;
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
     ACCORDION (transição de max-height estável)
     Abrir: max-height = altura real; ao terminar vira "none" (conteúdo dinâmico cabe).
     Fechar: fixa a altura atual, força reflow e anima até 0.
     ===================================================== */
  function abrirExtra(card) {
    const extra = card.querySelector('.card-extra');
    extra.style.maxHeight = extra.scrollHeight + 'px';
    const fim = (e) => {
      if (e.propertyName !== 'max-height') return;
      extra.removeEventListener('transitionend', fim);
      if (card.classList.contains('open')) extra.style.maxHeight = 'none';
    };
    extra.addEventListener('transitionend', fim);
  }

  function fecharExtra(card) {
    const extra = card.querySelector('.card-extra');
    extra.style.maxHeight = extra.scrollHeight + 'px';
    void extra.offsetHeight;                 // reflow
    extra.style.maxHeight = '0px';
  }

  function alternarExpansao(card) {
    const id = card.dataset.id;
    const vaiAbrir = !card.classList.contains('open');
    card.classList.toggle('open', vaiAbrir);
    vaiAbrir ? expandidos.add(id) : expandidos.delete(id);
    card.querySelector('.card-main').setAttribute('aria-expanded', String(vaiAbrir));
    vaiAbrir ? abrirExtra(card) : fecharExtra(card);
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

  function tratarAcao(acao, card, btn) {
    const t = achar(card.dataset.id);
    if (!t) return;

    switch (acao) {
      case 'check': {
        if (ocupados.has(t.id)) return;
        ocupados.add(t.id);
        // 1) feedback visual imediato: círculo preenche, texto esmaece e ganha risca
        card.classList.toggle('done', t.status !== 'concluido');
        // 2) depois da animação, muda de coluna
        setTimeout(() => {
          alternarConcluida(t);
          ocupados.delete(t.id);
          salvar();
          renderizar();
        }, 400);
        return;
      }
      case 'sub-check': {
        const s = t.subtarefas.find((x) => x.id === btn.dataset.sid);
        if (!s) return;
        s.concluida = !s.concluida;
        btn.closest('.sub').classList.toggle('concluida', s.concluida);   // anima sem re-renderizar
        atualizarIndicador(card, t);
        salvar();
        return;
      }
      case 'sub-del':
        t.subtarefas = t.subtarefas.filter((x) => x.id !== btn.dataset.sid);
        renumerar(t);
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
        tarefas = tarefas.filter((x) => x.id !== t.id);
        expandidos.delete(t.id);
        break;
    }
    salvar();
    renderizar();
  }

  /* Delegação de eventos */
  slider.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const btn = e.target.closest('[data-action]');
    if (btn) { tratarAcao(btn.dataset.action, card, btn); return; }
    if (e.target.closest('.card-main')) alternarExpansao(card);
  });

  slider.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('card-main')) {
      e.preventDefault();
      alternarExpansao(e.target.closest('.card'));
    }
  });

  /* Adicionar subtarefa dentro do card */
  slider.addEventListener('submit', (e) => {
    e.preventDefault();
    const formSub = e.target.closest('.sub-add');
    if (!formSub) return;
    const card = formSub.closest('.card');
    const texto = formSub.querySelector('input').value.trim();
    const t = achar(card.dataset.id);
    if (!t || !texto) return;
    t.subtarefas.push({ id: `sub-${t.subtarefas.length + 1}`, titulo: texto, concluida: false });
    refocarSub = t.id;
    salvar();
    renderizar();
  });

  /* ---------- Limpar tudo (só concluídas) ---------- */
  $('#btn-limpar').addEventListener('click', () => {
    const qtd = tarefas.filter((t) => t.status === 'concluido').length;
    if (!qtd) return;
    const msg = `Apagar permanentemente ${qtd} tarefa${qtd > 1 ? 's' : ''} concluída${qtd > 1 ? 's' : ''}?`;
    if (!window.confirm(msg)) return;

    document.querySelectorAll('#list-concluido .card').forEach((c) => c.classList.add('fade-out'));
    setTimeout(() => {
      tarefas = tarefas.filter((t) => t.status !== 'concluido');
      salvar();
      renderizar();
    }, 320);
  });

  /* =====================================================
     SEGMENTED CONTROL + SWIPE
     ===================================================== */
  function irParaAba(i) {
    abaAtual = Math.max(0, Math.min(COLUNAS.length - 1, i));
    slider.style.transform = `translateX(${-abaAtual * (100 / 3)}%)`;
    $('#tab-indicator').style.transform = `translateX(${abaAtual * 100}%)`;
    document.querySelectorAll('.seg').forEach((b, idx) => {
      b.classList.toggle('active', idx === abaAtual);
      b.setAttribute('aria-selected', String(idx === abaAtual));
    });
  }

  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.seg');
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
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      irParaAba(abaAtual + (dx < 0 ? 1 : -1));
    }
  }, { passive: true });

  /* =====================================================
     FOLHA MODAL (criar / editar)
     ===================================================== */
  const selCategoria = $('#f-categoria');
  CATEGORIAS.forEach((c) => selCategoria.append(el('option', { value: c.nome, text: c.nome })));

  function abrirFolha(t) {
    editandoId = t ? t.id : null;
    $('#sheet-titulo').textContent = t ? 'Editar tarefa' : 'Nova tarefa';
    $('#f-titulo').value = t ? t.titulo : '';
    selCategoria.value = t ? t.categoria : 'Trabalho';
    $('#f-status').value = t ? (t.status === 'concluido' ? 'entrada' : t.status) : (abaAtual === 1 ? 'foco' : 'entrada');
    $('#f-status').disabled = !!(t && t.status === 'concluido');
    $('#f-prazo').value = t ? t.prazo : '';
    $('#f-subs').value = t ? t.subtarefas.map((s) => s.titulo).join('\n') : '';
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
  }

  function fecharFolha() {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    if (document.activeElement) document.activeElement.blur();
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
    const categoria = selCategoria.value;
    const prazo = $('#f-prazo').value;

    if (editandoId) {
      const t = achar(editandoId);
      if (t) {
        t.titulo = titulo;
        t.categoria = categoria;
        t.prazo = prazo;
        if (t.status !== 'concluido') { t.status = $('#f-status').value; t.statusAnterior = t.status; }
        // preserva o "concluida" das subtarefas que mantiveram o mesmo texto
        const antigas = [...t.subtarefas];
        t.subtarefas = linhas.map((texto) => {
          const i = antigas.findIndex((s) => s.titulo === texto);
          return i >= 0 ? antigas.splice(i, 1)[0] : { id: '', titulo: texto, concluida: false };
        });
        renumerar(t);
      }
    } else {
      const status = $('#f-status').value;
      tarefas.push(novaTarefa(titulo, categoria, status, prazo, linhas));
      irParaAba(status === 'foco' ? 1 : 0);
    }

    salvar();
    renderizar();
    fecharFolha();
  });

  /* =====================================================
     INICIALIZAÇÃO
     ===================================================== */
  // Atualiza data e alertas ao voltar para o app e a cada minuto (virada de dia)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderizar(); });
  setInterval(renderizar, 60000);

  tarefas = carregar();   // lê (e migra, se preciso) os dados salvos
  salvar();               // grava no novo formato
  renderizar();
  irParaAba(0);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
