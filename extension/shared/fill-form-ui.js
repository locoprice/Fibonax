// DOM presentation shared by the overlay, popup and mobile fill forms.
// Existing controls keep their handlers, values, order and keyboard semantics.
(function(root) {
  'use strict';
  function enhance(host, vm, cfg) {
    if (!host || host._fillUI) return;
    host.classList.add('ff-form');
    var rows = Array.prototype.slice.call(host.querySelectorAll(cfg.row));
    rows.forEach(function(row, index) {
      var field = vm.fields[index];
      if (!field) return;
      row.classList.add('ff-field');
      row.dataset.ffKey = field.key;
      var title = root.SBFillForm.fieldTitle(field);
      row.querySelectorAll(cfg.caption).forEach(function(el) { el.remove(); });
      var label = document.createElement('div');
      label.className = 'ff-label';
      label.textContent = title;
      row.prepend(label);
      row.querySelectorAll(cfg.control).forEach(function(el) {
        if (el.type !== 'radio' && el.type !== 'checkbox') el.setAttribute('aria-label', title);
      });
      var menu = row.querySelector(cfg.menu);
      if (menu) {
        var dropdown = document.createElement('details');
        dropdown.className = 'ff-menu';
        var summary = document.createElement('summary');
        summary.setAttribute('aria-label', title + ' — choices');
        dropdown.appendChild(summary);
        menu.replaceWith(dropdown);
        dropdown.appendChild(menu);
        dropdown.addEventListener('keydown', function(e) {
          if (e.key === 'Escape' && dropdown.open) {
            e.stopPropagation(); dropdown.open = false; summary.focus();
          }
        });
        dropdown.addEventListener('change', function(e) {
          if (e.target.type === 'radio' && !e.target.hasAttribute('data-other')) {
            dropdown.open = false; summary.focus();
          }
        });
      }
      var error = document.createElement('p');
      error.className = 'ff-error';
      error.setAttribute('role', 'alert');
      error.id = 'ff-error-' + cfg.prefix + '-' + index;
      error.hidden = true;
      row.appendChild(error);
      row.querySelectorAll(cfg.control).forEach(function(el) { el.setAttribute('aria-describedby', error.id); });
    });
    if (vm.sections.length > 1) {
      vm.sections.forEach(function(section) {
        var group = document.createElement('details'); group.className = 'ff-section'; group.open = true;
        var summary = document.createElement('summary'); summary.textContent = section.title;
        group.appendChild(summary);
        var grid = document.createElement('div'); grid.className = 'ff-grid'; group.appendChild(grid);
        var members = rows.filter(function(row) { return section.keys.indexOf(row.dataset.ffKey) !== -1; });
        if (members.length) members[0].before(group);
        members.forEach(function(row) { grid.appendChild(row); });
      });
    }
    host._fillUI = { rows: rows, cfg: cfg, attempted: false };
    refresh(host, vm);
  }
  function refresh(host, vm) {
    if (!host || !host._fillUI) return;
    var state = host._fillUI;
    state.rows.forEach(function(row) {
      var field = vm.fields.find(function(f) { return f.key === row.dataset.ffKey; });
      if (!field) return;
      var summary = row.querySelector('.ff-menu > summary');
      if (summary) summary.textContent = field.value || (field.otherOn ? field.other : 'Choose an option');
      row.querySelector('.ff-label').textContent = root.SBFillForm.fieldTitle(field) + (field.required ? ' *' : '');
      var message = state.attempted ? field.error : '';
      var error = row.querySelector('.ff-error'); error.hidden = !message; error.textContent = message;
      row.querySelectorAll(state.cfg.control).forEach(function(el) {
        el.setAttribute('aria-invalid', message ? 'true' : 'false');
      });
    });
  }
  function validate(host, vm) {
    if (!host || !host._fillUI) return vm.errors.length === 0;
    host._fillUI.attempted = true; refresh(host, vm);
    if (!vm.errors.length) return true;
    var row = host._fillUI.rows.find(function(r) { return r.dataset.ffKey === vm.errors[0].key; });
    if (row) {
      var parent = row.parentElement;
      while (parent && parent !== host) { if (parent.tagName === 'DETAILS') parent.open = true; parent = parent.parentElement; }
      var menu = row.querySelector('.ff-menu'); if (menu) menu.open = true;
      var control = row.querySelector(host._fillUI.cfg.control);
      if (control) control.focus();
      row.scrollIntoView({block:'nearest'});
    }
    return false;
  }
  root.SBFillFormUI = { enhance: enhance, refresh: refresh, validate: validate };
})(typeof window !== 'undefined' ? window : this);
