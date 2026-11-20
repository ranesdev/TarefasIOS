/* =====================================================
   TAREFAS iOS — lógica (JavaScript puro + LocalStorage)

   Esquema salvo no LocalStorage (chave "tarefas-ios.v2"):
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
  const MAX_TEXTO = 120;

  // Cor de cada categoria ("R,G,B") — usada na borda do círculo e na tag
  const CATEGORIAS = [
    { nome: 'Trabalho', cor: '255,69,58' },    // vermelho
    { nome: 'Pessoal',  cor: '10,132,255' },   // azul
    { nome: 'Estudos',  cor: '191,90,242' },   // roxo
    { nome: 'Saúde',    cor: '48,209,88' },    // verde
    { nome: 'Finanças', cor: '255,214,10' },   // amarelo
  ];

  const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
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
  let ultimoSalvo = null;         // último JSON gravado/lido (detecta mudanças vindas de outra aba)
  let diaRenderizado = '';        // dia da última renderização (virada de dia)

  /* ---------- Aviso (toast) ---------- */
  let toastTimer = null;
  function avisar(msg) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 5000);
  }

  /* =====================================================
     DADOS
     ===================================================== */
  function novoId() {
    let n = Date.now();
    while (tarefas.some((t) => t.id === String(n))) n++;
    return String(n);
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

  /** Aceita só "AAAA-MM-DD" de uma data que realmente existe. */
  function dataValida(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return '';
    const [y, m, d] = v.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? v : '';
  }

  /** Aceita o esquema novo e o antigo (texto/feito) e devolve o esquema novo, já saneado. */
  function normalizar(dados) {
    if (!Array.isArray(dados)) return [];
    const usados = new Set();
    const idLivre = () => {
      let n = Date.now();
      while (usados.has(String(n))) n++;
      return String(n);
    };
    const saida = [];

    for (const t of dados) {
      if (!t || typeof t.titulo !== 'string' || !t.titulo.trim()) continue;

      let id = String(t.id === undefined || t.id === null ? '' : t.id);
      if (!/^\d{1,16}$/.test(id) || usados.has(id)) id = idLivre();   // id numérico e único
      usados.add(id);

      const status = COLUNAS.includes(t.status) ? t.status : 'entrada';
      const nova = {
        id,
        titulo: t.titulo.trim().slice(0, MAX_TEXTO),
        status,
        categoria: categoriaValida(t.categoria),
        prazo: dataValida(t.prazo),
        subtarefas: (Array.isArray(t.subtarefas) ? t.subtarefas : [])
          .filter((s) => s && String(s.titulo !== undefined ? s.titulo : (s.texto || '')).trim())
          .map((s) => ({
            id: '',
            titulo: String(s.titulo !== undefined ? s.titulo : s.texto).trim().slice(0, MAX_TEXTO),
            concluida: !!(s.concluida !== undefined ? s.concluida : s.feito),
          })),
        statusAnterior: COLUNAS.includes(t.statusAnterior) && t.statusAnterior !== 'concluido' ? t.statusAnterior : 'entrada',
        concluidaEm: Number.isFinite(t.concluidaEm) ? t.concluidaEm : null,
      };
      renumerar(nova);
      saida.push(nova);
    }
    return saida;
  }

  /** Lê o LocalStorage. Sem dados => lista vazia (o app NÃO cria tarefas de exemplo). */
  function carregar() {
    let bruto = null;
    try {
      bruto = localStorage.getItem(STORAGE_KEY);
      if (bruto === null) bruto = localStorage.getItem(STORAGE_KEY_V1);   // migra dados da versão anterior
    } catch (e) {
      avisar('Armazenamento indisponível: as tarefas não serão salvas.');
      return [];
    }
    if (bruto === null) return [];

    try {
      return normalizar(JSON.parse(bruto));
    } catch (e) {
      // dados ilegíveis: guarda uma cópia antes de qualquer gravação nova
      try { localStorage.setItem(STORAGE_KEY + '.corrompido', bruto); } catch (_) { /* ignora */ }
      avisar('Dados ilegíveis. Uma cópia foi guardada e o app iniciou vazio.');
      return [];
    }
  }

  function salvar() {
    try {
      const json = JSON.stringify(tarefas);
      localStorage.setItem(STORAGE_KEY, json);
      ultimoSalvo = json;
      return true;
    } catch (e) {
      avisar('Não foi possível salvar. Verifique o armazenamento do Safari.');
      return false;
    }
  }

  /** Se outra aba/janela alterou os dados, recarrega (evita sobrescrever o trabalho dela). */
  function sincronizar() {
    let bruto;
    try { bruto = localStorage.getItem(STORAGE_KEY); } catch (e) { return; }
    if (bruto === null || bruto === ultimoSalvo) return;
    try {
      tarefas = normalizar(JSON.parse(bruto));
      ultimoSalvo = bruto;
    } catch (e) { return; }
    if (editandoId && !achar(editandoId)) fecharFolha();   // a tarefa editada sumiu
    renderizar();
  }

  /* =====================================================
     DATAS
     ===================================================== */
  function inicioDoDia() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  const chaveDia = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

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
     DOM (sem innerHTML com dados do usuário; sem estilos inline => compatível com CSP)
     ===================================================== */
  function el(tag, attrs, ...filhos) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'cor') n.style.setProperty('--c', v);   // cor da categoria (via CSSOM)
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const f of filhos) if (f) n.append(f);
    return n;
  }

  // Apenas para os ícones fixos abaixo (nunca recebe dados do usuário)
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
      el('input', { type: 'text', placeholder: 'Nova subtarefa…', maxlength: String(MAX_TEXTO), enterkeyhint: 'done', 'aria-label': 'Nova subtarefa' })
    );

    const acoes = el('div', { class: 'actions' });
    if (t.status === 'entrada') acoes.append(el('button', { class: 'act', type: 'button', 'data-action': 'move', 'data-to': 'foco', text: 'Mover p/ Foco' }));
    if (t.status === 'foco') acoes.append(el('button', { class: 'act', type: 'button', 'data-action': 'move', 'data-to': 'entrada', text: 'Voltar p/ Entrada' }));
    acoes.append(
      el('button', { class: 'act', type: 'button', 'data-action': 'edit', text: 'Editar' }),
      el('button', { class: 'act danger', type: 'button', 'data-action': 'delete', text: 'Excluir' })
    );

    const extra = el('div', { class: 'card-extra' },
      el('div', { class: 'extra-pad' }, lista, addForm, acoes)
    );
    if (aberto) extra.style.maxHeight = 'none';

    return el('article', {
      class: 'card' + (t.status === 'concluido' ? ' done' : '') + (aberto ? ' open' : ''),
      'data-id': t.id,
      cor: corDe(t.categoria),
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
    diaRenderizado = chaveDia();
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
      const card = Array.from(document.querySelectorAll('.card')).find((c) => c.dataset.id === refocarSub);
      const input = card && card.querySelector('.sub-add input');
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
    if (ocupados.has(t.id)) return;          // card em animação de "concluir": ignora toques extras

    switch (acao) {
      case 'check': {
        ocupados.add(t.id);
        // 1) feedback visual imediato: círculo preenche, texto esmaece e ganha risca
        card.classList.toggle('done', t.status !== 'concluido');
        // 2) depois da animação, muda de coluna (busca a tarefa de novo: pode ter mudado)
        const id = t.id;
        setTimeout(() => {
          ocupados.delete(id);
          const atual = achar(id);
          if (atual) { alternarConcluida(atual); salvar(); }
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
        t.status = btn.dataset.to === 'foco' ? 'foco' : 'entrada';
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
      default:
        return;
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
    const texto = formSub.querySelector('input').value.trim().slice(0, MAX_TEXTO);
    const t = achar(card.dataset.id);
    if (!t || !texto || ocupados.has(t.id)) return;
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
    editandoId = null;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  $('#fab').addEventListener('click', () => abrirFolha(null));
  $('#btn-cancelar').addEventListener('click', fecharFolha);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) fecharFolha(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharFolha(); });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const titulo = $('#f-titulo').value.trim().slice(0, MAX_TEXTO);
    if (!titulo) { $('#f-titulo').focus(); return; }

    const linhas = $('#f-subs').value.split('\n').map((l) => l.trim().slice(0, MAX_TEXTO)).filter(Boolean);
    const categoria = CATEGORIAS.some((c) => c.nome === selCategoria.value) ? selCategoria.value : 'Pessoal';
    const prazo = dataValida($('#f-prazo').value);
    const statusEscolhido = $('#f-status').value === 'foco' ? 'foco' : 'entrada';

    if (editandoId) {
      const t = achar(editandoId);
      if (t) {
        t.titulo = titulo;
        t.categoria = categoria;
        t.prazo = prazo;
        if (t.status !== 'concluido') { t.status = statusEscolhido; t.statusAnterior = t.status; }
        // preserva o "concluida" das subtarefas que mantiveram o mesmo texto
        const antigas = [...t.subtarefas];
        t.subtarefas = linhas.map((texto) => {
          const i = antigas.findIndex((s) => s.titulo === texto);
          return i >= 0 ? antigas.splice(i, 1)[0] : { id: '', titulo: texto, concluida: false };
        });
        renumerar(t);
      }
    } else {
      tarefas.push(novaTarefa(titulo, categoria, statusEscolhido, prazo, linhas));
      irParaAba(statusEscolhido === 'foco' ? 1 : 0);
    }

    salvar();
    renderizar();
    fecharFolha();
  });

  /* =====================================================
     INICIALIZAÇÃO
     ===================================================== */
  // Virada de dia: só redesenha se o dia mudou (evita apagar o que o usuário está digitando)
  function verificarDia() {
    if (chaveDia() !== diaRenderizado) renderizar();
  }

  setInterval(verificarDia, 60000);

  // Ao voltar para o app (iOS congela abas em segundo plano): reconcilia dados e dia
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { sincronizar(); verificarDia(); }
  });
  window.addEventListener('pageshow', () => { sincronizar(); verificarDia(); });

  // Outra aba/janela do mesmo site alterou os dados
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY || e.key === null) sincronizar();
  });

  tarefas = carregar();   // lê (e migra, se preciso) os dados salvos; vazio no primeiro uso
  salvar();               // grava no formato atual
  renderizar();
  irParaAba(0);

  // Pede ao Safari para não apagar os dados por inatividade (quando suportado)
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
