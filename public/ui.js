// Shared controls, with the original select kept as the form's source of truth.
(() => {
  const create = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  let opened;
  class SelectControl {
    constructor(select) {
      this.select = select;
      this.active = -1;
      this.wrapper = create('div', 'custom-select');
      this.trigger = create('button', 'select-trigger');
      this.trigger.type = 'button';
      this.trigger.id = `${select.id}-trigger`;
      this.trigger.setAttribute('role', 'combobox');
      this.trigger.setAttribute('aria-haspopup', 'listbox');
      this.trigger.setAttribute('aria-expanded', 'false');
      this.value = create('span', 'select-value');
      this.trigger.append(this.value, create('span', 'select-chevron'));
      this.wrapper.append(this.trigger);
      this.popup = create('div', 'select-popup');
      this.popup.hidden = true;
      this.search = create('input', 'select-search');
      this.search.type = 'text';
      this.search.autocomplete = 'off';
      this.search.spellcheck = false;
      this.search.placeholder = 'Rechercher dans la liste…';
      this.search.setAttribute('aria-label', 'Rechercher dans la liste');
      this.search.setAttribute('role', 'combobox');
      this.search.setAttribute('aria-autocomplete', 'list');
      this.search.setAttribute('aria-expanded', 'true');
      this.list = create('div', 'select-options');
      this.list.id = `${select.id}-options`;
      this.list.setAttribute('role', 'listbox');
      this.trigger.setAttribute('aria-controls', this.list.id);
      this.search.setAttribute('aria-controls', this.list.id);
      this.empty = create('p', 'select-empty', 'Aucun résultat');
      this.hint = create('p', 'select-hint', '↑ ↓ Parcourir · Entrée Choisir · Échap Fermer');
      this.popup.append(this.search, this.list, this.empty, this.hint);
      const label = select.labels?.[0];
      this.label = select.getAttribute('aria-label') || label?.textContent || 'Sélection';
      this.list.setAttribute('aria-label', this.label);
      if (label) label.htmlFor = this.trigger.id;
      select.after(this.wrapper);
      document.body.append(this.popup);
      select.hidden = true;
      select.setAttribute('aria-hidden', 'true');
      select.tabIndex = -1;
      this.trigger.addEventListener('click', () => this.isOpen ? this.close() : this.open());
      this.trigger.addEventListener('keydown', event => this.key(event));
      this.search.addEventListener('keydown', event => this.key(event));
      this.search.addEventListener('input', () => this.renderOptions());
      select.addEventListener('change', () => this.sync());
      new MutationObserver(() => this.sync()).observe(select, { childList: true, subtree: true, attributes: true, characterData: true });
      this.sync();
    }
    sync() {
      this.trigger.disabled = this.select.disabled;
      this.value.textContent = this.select.selectedOptions[0]?.textContent || 'Choisir…';
      this.trigger.setAttribute('aria-label', `${this.label} : ${this.value.textContent}`);
      if (this.isOpen) {
        if (this.select.disabled) this.close();
        else this.renderOptions();
      }
    }
    open() {
      if (this.select.disabled) return;
      opened?.close();
      opened = this;
      this.isOpen = true;
      this.trigger.setAttribute('aria-expanded', 'true');
      this.popup.hidden = false;
      this.search.value = '';
      this.search.hidden = this.select.options.length <= 8;
      this.position();
      this.renderOptions();
      if (!this.search.hidden) this.search.focus({ preventScroll: true });
    }
    close(restoreFocus = false) {
      this.isOpen = false;
      this.popup.hidden = true;
      this.trigger.setAttribute('aria-expanded', 'false');
      this.trigger.removeAttribute('aria-activedescendant');
      this.search.removeAttribute('aria-activedescendant');
      if (opened === this) opened = undefined;
      if (restoreFocus) this.trigger.focus({ preventScroll: true });
    }
    renderOptions() {
      const query = normalize(this.search.value.trim());
      this.options = [...this.select.options].filter(option => !option.hidden && normalize(option.textContent).includes(query));
      this.nodes = this.options.map((option, index) => {
        const node = create('div', 'select-option', option.textContent);
        node.id = `${this.select.id}-option-${index}`;
        node.setAttribute('role', 'option');
        node.setAttribute('aria-selected', String(option.selected));
        node.setAttribute('aria-disabled', String(option.disabled));
        node.addEventListener('pointermove', () => this.activate(index, false));
        node.addEventListener('pointerdown', event => event.preventDefault());
        node.addEventListener('click', () => this.choose(index));
        return node;
      });
      this.list.replaceChildren(...this.nodes);
      this.empty.hidden = this.options.length > 0;
      const selected = this.options.findIndex(option => option.selected && !option.disabled);
      this.activate(selected < 0 ? this.options.findIndex(option => !option.disabled) : selected);
    }
    activate(index, scroll = true) {
      if (this.options[index]?.disabled) return;
      this.active = index;
      this.nodes.forEach((node, i) => node.classList.toggle('is-active', i === index));
      for (const control of [this.trigger, this.search]) {
        if (this.nodes[index]) control.setAttribute('aria-activedescendant', this.nodes[index].id);
        else control.removeAttribute('aria-activedescendant');
      }
      if (scroll) this.nodes[index]?.scrollIntoView({ block: 'nearest' });
    }
    choose(index) {
      const option = this.options[index];
      if (!option || option.disabled) return;
      const changed = this.select.value !== option.value;
      this.select.value = option.value;
      this.sync();
      this.close(true);
      if (changed) this.select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    key(event) {
      if (event.key === 'Tab') {
        if (this.isOpen) this.close(event.target === this.search);
        return;
      }
      if (event.key === 'Escape' && this.isOpen) {
        event.preventDefault(); this.close(true); return;
      }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        if (!this.isOpen && ['Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        if (!this.isOpen) { this.open(); return; }
        const available = this.options.map((o, i) => o.disabled ? -1 : i).filter(i => i !== -1);
        const position = available.indexOf(this.active);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1 : Math.max(0, Math.min(available.length - 1, position + (event.key === 'ArrowDown' ? 1 : -1)));
        this.activate(available[next] ?? -1);
      } else if (event.key === 'Enter' || (event.key === ' ' && event.target === this.trigger)) {
        event.preventDefault();
        if (this.isOpen) this.choose(this.active); else this.open();
      } else if (event.target === this.trigger && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        if (!this.isOpen) this.open();
        if (!this.search.hidden) { this.search.value += event.key; this.renderOptions(); }
        else {
          this.typed = performance.now() - (this.typedAt || 0) < 700 ? (this.typed || '') + event.key : event.key;
          this.typedAt = performance.now();
          const match = this.options.findIndex(option => !option.disabled && normalize(option.textContent).startsWith(normalize(this.typed)));
          if (match >= 0) this.activate(match);
        }
      }
    }
    position() {
      const rect = this.trigger.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 290), window.innerWidth - 24);
      this.popup.style.width = `${width}px`;
      this.popup.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - width - 12))}px`;
      const below = window.innerHeight - rect.bottom - 20;
      const above = rect.top - 20;
      const upwards = below < 240 && above > below;
      this.popup.style.maxHeight = `${Math.max(100, upwards ? above : below)}px`;
      this.popup.style.top = upwards ? 'auto' : `${rect.bottom + 8}px`;
      this.popup.style.bottom = upwards ? `${window.innerHeight - rect.top + 8}px` : 'auto';
    }
  }
  document.querySelectorAll('select').forEach(select => new SelectControl(select));
  document.addEventListener('pointerdown', event => {
    if (opened && !opened.popup.contains(event.target) && !opened.wrapper.contains(event.target)) opened.close();
  });
  document.addEventListener('focusin', event => {
    if (opened && !opened.popup.contains(event.target) && !opened.wrapper.contains(event.target)) opened.close();
  });
  window.addEventListener('resize', () => opened?.position());
  document.addEventListener('scroll', event => {
    if (opened && !opened.popup.contains(event.target)) opened.position();
  }, true);

  document.querySelectorAll('input[type="search"]').forEach(input => {
    const wrapper = create('div', 'search-field');
    const icon = create('span', 'search-icon');
    icon.setAttribute('aria-hidden', 'true');
    const clear = create('button', 'search-clear', '×');
    clear.type = 'button';
    clear.setAttribute('aria-label', 'Effacer la recherche');
    input.before(wrapper); wrapper.append(icon, input, clear);
    const sync = () => { clear.hidden = !input.value; };
    input.addEventListener('input', sync);
    clear.addEventListener('click', () => {
      input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus();
    });
    sync();
  });

  const tooltip = create('div', 'custom-tooltip');
  tooltip.id = 'pulse-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  document.body.append(tooltip);
  let pointer;
  let tooltipTarget;
  const refreshTooltip = () => {
    const target = pointer && document.elementFromPoint(pointer.x, pointer.y)?.closest('[data-tooltip]');
    if (tooltipTarget !== target) tooltipTarget?.removeAttribute('aria-describedby');
    tooltipTarget = target;
    tooltip.hidden = !target;
    if (!target) return;
    target.setAttribute('aria-describedby', tooltip.id);
    tooltip.textContent = target.dataset.tooltip;
    tooltip.style.left = `${Math.max(8, Math.min(pointer.x + 12, window.innerWidth - tooltip.offsetWidth - 8))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(pointer.y + 18, window.innerHeight - tooltip.offsetHeight - 8))}px`;
  };
  document.addEventListener('pointermove', event => { pointer = { x: event.clientX, y: event.clientY }; refreshTooltip(); });
  const hideTooltip = () => { pointer = undefined; refreshTooltip(); };
  document.addEventListener('pointerleave', hideTooltip);
  document.addEventListener('keydown', hideTooltip);
  document.addEventListener('scroll', hideTooltip, true);
  window.addEventListener('blur', hideTooltip);
  window.PulseUI = { refreshTooltip };
})();
