import {productGroups} from './core.js';

// Keep IDs as text: names and quantities never establish product identity.
export function inventoryLinks(configs, shopId) {
  return productGroups(configs.filter(c => !c.deletedAt && !c.emptyLinkDraft && (c.shopId || 'intel') === shopId));
}

export function inventoryPlan(configs, shopId, productIds) {
  const picked = new Set(productIds);
  const groups = inventoryLinks(configs, shopId).filter(g => picked.has(g.id));
  const byId = new Map(), skipped = [];
  let occurrences = 0;
  for (const group of groups) for (const config of group.configs) for (const part of config.parts || []) {
    const name = String(part.name ?? '').trim(), raw = part.goodsId;
    const goodsId = String(raw ?? '').trim();
    if (!name && !goodsId) continue;
    const source = {product: group.name, config: config.name, slot: part.slot || '', productId: group.id, configId: config.id};
    const unsafeNumber = typeof raw === 'number' && !Number.isSafeInteger(raw);
    if (unsafeNumber || !/^\d+$/.test(goodsId) || /^0+$/.test(goodsId)) {
      skipped.push({...source, name, goodsId, reason: unsafeNumber ? '数字 ID 已有精度风险，请重新绑定文本 ID' : !goodsId || /^0+$/.test(goodsId) ? '未绑定 goodsid' : 'goodsid 格式无效'});
      continue;
    }
    occurrences++;
    if (!byId.has(goodsId)) byId.set(goodsId, {goodsId, names: [], slots: [], sources: []});
    const row = byId.get(goodsId);
    if (name && !row.names.includes(name)) row.names.push(name);
    if (part.slot && !row.slots.includes(part.slot)) row.slots.push(part.slot);
    row.sources.push(source);
  }
  return {groups, rows: [...byId.values()], skipped, occurrences,
    merged: occurrences - byId.size, configCount: groups.reduce((n, g) => n + g.configs.length, 0)};
}

export function inventoryCsv(plan, threshold = 10) {
  const value = String(threshold).trim();
  if (!/^\d+$/.test(value) || Number(value) > 100000000) throw Error('预警值须为 0 至 100000000 的整数');
  if (!plan.rows.length) throw Error('所选链接没有可导出的 goodsid');
  if (plan.rows.length > 5000) throw Error('库存监控每次最多导入 5000 个配件，请分批选择链接');
  const cell = value => {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const rows = [['goodsid', '名称', '预警值', '配件类别', '来源链接', '来源配置']];
  for (const row of plan.rows) rows.push([row.goodsId, row.names[0] || '', Number(value), row.slots.join(' / '),
    [...new Set(row.sources.map(s => s.product))].join('；'),
    [...new Set(row.sources.map(s => `${s.product} / ${s.config}`))].join('；')]);
  const csv = '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
  if (new TextEncoder().encode(csv).length > 10 * 1024 * 1024) throw Error('导出文件超过库存监控 10 MB 限制，请分批选择链接');
  return csv;
}

export function openInventoryExport({openDialog, esc, getConfigs, shop, download, toast}) {
  const groups = inventoryLinks(getConfigs(), shop.id), selected = new Set();
  openDialog('库存监控导出', `
    <p class="hint">${esc(shop.name)} · 勾选商品链接，汇总链接内全部配置的配件。同一 goodsid 只导出一行，图片中隐藏的配件也会计入。</p>
    <div class="inventory-export-layout">
      <section aria-label="选择商品链接">
        <label class="field">搜索链接<input id="inventory-search" type="search" placeholder="链接名称、分类或 SPU"></label>
        <div class="inventory-toolbar"><label><input id="inventory-all" type="checkbox"> 全选筛选结果</label><button id="inventory-clear">清空选择</button></div>
        <div id="inventory-links" class="global-list inventory-links"></div>
      </section>
      <section aria-label="导出预览">
        <p id="inventory-summary" class="inventory-summary" role="status" aria-live="polite"></p>
        <label class="field">统一预警值<input id="inventory-threshold" type="number" min="0" max="100000000" step="1" value="10"></label>
        <p class="hint">预警值用于库存提醒，与配置中的配件数量无关。</p>
        <div id="inventory-preview" class="inventory-preview"></div>
        <details id="inventory-skipped" class="inventory-skipped" hidden><summary id="inventory-skipped-title"></summary><div id="inventory-skipped-list"></div></details>
      </section>
    </div>
    <p class="hint">导出后，在后台库存监控中选择「导入产品」，直接选择 CSV，核对匹配总览后确认。导入按 goodsid 精确匹配，使用公司大库可销数。已有监控项会更新预警值并保留原启用状态。</p>
    <p id="inventory-status" class="hint" role="status"></p>
    <div class="actions"><button id="inventory-download" class="primary" disabled>导出监控 CSV</button></div>`);
  const $ = s => document.querySelector(s);
  $('#dialog').classList.add('inventory-dialog');
  const filtered = () => {
    const query = $('#inventory-search').value.trim().toLowerCase();
    return groups.filter(g => [g.name, g.category, g.spu, g.url].join(' ').toLowerCase().includes(query));
  };
  const update = () => {
    const plan = inventoryPlan(getConfigs(), shop.id, [...selected]), visible = filtered();
    $('#inventory-all').checked = !!visible.length && visible.every(g => selected.has(g.id));
    $('#inventory-all').indeterminate = visible.some(g => selected.has(g.id)) && !$('#inventory-all').checked;
    $('#inventory-all').disabled = !visible.length;
    $('#inventory-clear').disabled = !selected.size;
    $('#inventory-summary').textContent = `已选 ${plan.groups.length} 个链接 · ${plan.configCount} 套配置 · ${plan.rows.length} 个唯一 goodsid（合并 ${plan.merged} 处重复）`;
    $('#inventory-preview').innerHTML = plan.rows.length ? `<table><thead><tr><th>goodsid / 配件</th><th>来源</th></tr></thead><tbody>${plan.rows.map(row => `<tr><td><code>${esc(row.goodsId)}</code><div>${esc(row.names[0] || '未填写名称')}</div>${row.names.length > 1 ? `<small>同 ID 存在 ${row.names.length} 种名称，按 ID 合并</small>` : ''}</td><td><details><summary>${new Set(row.sources.map(s => s.productId)).size} 个链接 · ${new Set(row.sources.map(s => s.configId)).size} 套配置</summary>${row.sources.map(s => `<small>${esc(s.product)} / ${esc(s.config)} / ${esc(s.slot)}</small>`).join('')}</details></td></tr>`).join('')}</tbody></table>` : '<p class="hint">勾选左侧链接后，在这里核对去重后的配件。</p>';
    $('#inventory-skipped').hidden = !plan.skipped.length;
    $('#inventory-skipped-title').textContent = `${plan.skipped.length} 处配件缺少有效 ID，已跳过（展开查看）`;
    $('#inventory-skipped-list').innerHTML = plan.skipped.map(row => `<p>${esc(row.product)} / ${esc(row.config)} / ${esc(row.slot)}<br>${esc(row.name || '未填写名称')} · ${esc(row.reason)}</p>`).join('');
    let problem = '';
    try { inventoryCsv(plan, $('#inventory-threshold').value); } catch (error) { problem = error.message; }
    $('#inventory-download').disabled = !!problem;
    $('#inventory-status').textContent = selected.size ? problem || `可导出 ${plan.rows.length} 个配件${plan.skipped.length ? `；${plan.skipped.length} 处缺少有效 ID 的配件不会加入监控` : ''}。` : '请先勾选需要监控的商品链接。';
  };
  const renderLinks = () => {
    $('#inventory-links').innerHTML = filtered().map((g, i) => `<label><input type="checkbox" data-inventory-link="${i}" ${selected.has(g.id) ? 'checked' : ''}><span><strong>${esc(g.name)}</strong><small>${esc(g.category || '未分类')} · SPU ${esc(g.spu || '未填写')} · ${g.configs.length} 套配置</small></span></label>`).join('') || '<p class="hint">没有匹配的商品链接。</p>';
    const visible = filtered();
    document.querySelectorAll('[data-inventory-link]').forEach(el => el.onchange = () => {
      const id = visible[Number(el.dataset.inventoryLink)].id;
      el.checked ? selected.add(id) : selected.delete(id);
      update();
    });
    update();
  };
  $('#inventory-search').oninput = renderLinks;
  $('#inventory-all').onchange = e => { filtered().forEach(g => e.target.checked ? selected.add(g.id) : selected.delete(g.id)); renderLinks(); };
  $('#inventory-clear').onclick = () => { selected.clear(); renderLinks(); };
  $('#inventory-threshold').oninput = update;
  $('#inventory-download').onclick = () => {
    try {
      const plan = inventoryPlan(getConfigs(), shop.id, [...selected]);
      const csv = inventoryCsv(plan, $('#inventory-threshold').value);
      const stamp = new Date().toLocaleDateString('sv-SE');
      download(new Blob([csv], {type: 'text/csv;charset=utf-8'}), `库存监控_${shop.name}_${stamp}.csv`);
      $('#inventory-status').textContent = `已导出 ${plan.rows.length} 个唯一 goodsid${plan.skipped.length ? `，跳过 ${plan.skipped.length} 处无有效 ID 的配件` : ''}。请在库存监控中导入并确认。`;
      toast(`已导出 ${plan.rows.length} 个配件的监控 CSV`);
    } catch (error) { $('#inventory-status').textContent = error.message; }
  };
  renderLinks();
}
