// Naming functions extracted read-only from user supplied V5.0 HTML.
    function configOrdinal(value) {
      const text = String(value || "").trim().replace(/^配置/, "");
      if (/^\d+$/.test(text)) return Number(text);
      const cn = ["一","二","三","四","五","六","七","八","九","十","十一","十二","十三","十四","十五","十六","十七","十八","十九","二十","二十一","二十二","二十三","二十四","二十五","二十六","二十七","二十八","二十九","三十"];
      const index = cn.indexOf(text);
      return index >= 0 ? index + 1 : 0;
    }


    function arabicConfigName(value) {
      const text = String(value || "").trim();
      const ordinal = configOrdinal(text);
      return ordinal ? `配置${ordinal}` : text;
    }


    function shortCpu(text) {
      const value = String(text || "").toUpperCase();
      let m = value.match(/ULTRA\s*\d+\s*([0-9]{3}K(?:F)?(?:\s*PLUS)?)/);
      if (m) return m[1].replace(/\s+/g, " ").trim();
      m = value.match(/\bI[3579]\s*[- ]?\s*([0-9]{4,5}[A-Z]{0,3})\b/);
      if (m) return m[1];
      m = value.match(/\bRYZEN\s*[3579]\s*[- ]?\s*([0-9]{4,5}(?:[A-Z][A-Z0-9]{0,4})?)\b/);
      if (m) return m[1];
      m = value.match(/\b([0-9]{4,5}[A-Z]{0,3})\b/);
      return m ? m[1] : "";
    }


    function gpuInfo(text) {
      const value = String(text || "");
      const compact = value.toUpperCase().replace(/\s+/g, "");
      const modelMatch = compact.match(/(RTX[0-9]{4}(?:TI|SUPER)?|RX[0-9]{4}(?:XT|GRE)?|ARC[A-Z0-9]+)/);
      let model = modelMatch ? modelMatch[1].replace("RTX", "RTX ").replace("TI", "Ti") : "";
      const vramMatches = [...value.toUpperCase().matchAll(/(?:^|[^A-Z0-9])(\d{1,2})\s*G(?:B)?\b/g)];
      const vram = vramMatches.length ? vramMatches[vramMatches.length - 1][1] : "";
      const keepVram = /RTX\s*5060\s*TI/i.test(model) && vram === "16";
      return { model, vram: keepVram ? "16GB" : "" };
    }


    function formatOneGpuTail(value) {
      const text = String(value || "").trim();
      const is5060Ti = /(?:RTX\s*)?5060\s*Ti/i.test(text);
      return text
        .replace(/(^|\s)(\d{1,2})\s*G(?:B)?\b/ig, (match, prefix, amount) =>
          is5060Ti && amount === "16" ? `${prefix}16GB` : ""
        )
        .replace(/\s+/g, " ")
        .trim();
    }


    function normalizedErpConfigName(pkg) {
      const raw = String(pkg.erpConfigNameRaw || "").trim();
      const actualCpu = pkg.cpuShort || shortCpu((pkg.parts.CPU || {}).display) || "CPU";
      const colonIndex = Math.max(raw.indexOf("："), raw.indexOf(":"));
      const rawPrefix = colonIndex >= 0 ? raw.slice(0, colonIndex).trim() : "";
      const prefix = arabicConfigName(/^配置(?:\d+|[一二三四五六七八九十]+)$/.test(rawPrefix) ? rawPrefix : pkg.name);
      const body = colonIndex >= 0 ? raw.slice(colonIndex + 1).trim() : "";
      const dividerIndex = body.indexOf("丨");
      const rawCpu = dividerIndex >= 0 ? body.slice(0, dividerIndex).trim() : "";
      const rawTail = dividerIndex >= 0 ? body.slice(dividerIndex + 1).trim() : body;
      const cpu = !rawCpu || rawCpu === "无" || rawCpu === "0" ? actualCpu : rawCpu;
      const tail = rawTail
        .split(/\s+/)
        .map(value => value.trim())
        .filter(value => value && value !== "无" && value !== "0");
      const versionOnlyTail = pkg.version && tail.length === 1 && tail[0] === pkg.version;
      if (!tail.length || versionOnlyTail) {
        tail.length = 0;
        if (pkg.gpu === "无卡" || pkg.gpu === "无" || !pkg.gpu) tail.push("无卡");
        else tail.push(pkg.gpu);
        if (pkg.vram && pkg.vram !== "无" && !String(tail.join(" ")).includes(pkg.vram)) tail.push(pkg.vram);
      }
      if (pkg.version && !tail.includes(pkg.version)) tail.push(pkg.version);
      return `${prefix || pkg.name}：${cpu}丨${formatOneGpuTail(tail.join(" "))}`;
    }


    function shortCapacityText(value, qty = "") {
      const text = String(value || "")
        .replace(/[Ｇｇ]/g, "G")
        .replace(/[Ｔｔ]/g, "T")
        .replace(/[Ｂｂ]/g, "B")
        .trim();
      if (!text || text === "0" || text === "无") return "";
      const explicitQty = Number((text.match(/(?:x|×|\*)\s*(\d+)\s*$/i) || [])[1] || 0);
      const suffixQty = explicitQty > 0 && explicitQty <= 16 ? explicitQty : 0;
      const multiplier = Math.max(1, Number(suffixQty || qty || 1) || 1);
      const capacityText = suffixQty ? text.replace(/(?:x|×|\*)\s*\d+\s*$/i, "") : text;
      const candidates = [];
      const pattern = /(\d+(?:\.\d+)?)\s*(TB|T|GB|G)(?![A-Z])/ig;
      let match;
      while ((match = pattern.exec(capacityText))) {
        const before = capacityText[match.index - 1] || "";
        if (/[A-Z]/i.test(before)) continue;
        const amount = Number(match[1]);
        const unit = match[2].toUpperCase();
        candidates.push({ amount, gb: unit.startsWith("T") ? amount * 1024 : amount });
      }
      if (!candidates.length) return "";
      let selected = candidates[candidates.length - 1];
      if (suffixQty && candidates.length > 1) {
        const perStick = candidates[candidates.length - 1];
        const total = candidates.find(item => Math.abs(item.gb - perStick.gb * suffixQty) < 0.001);
        if (total) selected = { ...total, noMultiply: true };
      }
      const totalGb = selected.gb * (selected.noMultiply ? 1 : multiplier);
      if (totalGb >= 1024 && totalGb % 1024 === 0) return `${totalGb / 1024}T`;
      return `${Number.isInteger(totalGb) ? totalGb : totalGb.toFixed(1).replace(/\.0$/, "")}G`;
    }


    function compactPartCapacity(pkg, type) {
      const part = (pkg.parts || {})[type] || {};
      return shortCapacityText(part.displayWithQty || part.display, part.qty);
    }


    function compactGpuText(value) {
      const text = String(value || "")
        .replace(/\b(?:RTX|GTX)\s*/ig, "")
        .replace(/(\d+)\s*GB\b/ig, "$1G")
        .replace(/\s+/g, " ")
        .trim();
      const keepVram = /5060\s*Ti/i.test(text) && /\b16G\b/i.test(text);
      return keepVram ? text : text.replace(/\s+\d+G\b/ig, "").trim();
    }


    function compactCpuText(value) {
      return String(value || "")
        .replace(/\b(250K|270K)\s+PLUS\b/ig, "$1")
        .replace(/\s+/g, " ")
        .trim();
    }


    function compactErpConfigName(pkg) {
      const parts = pkg.parts || {};
      const cpu = compactCpuText(pkg.cpuShort
        || (typeof shortCpu === "function" ? shortCpu((parts.CPU || {}).display) : "")
        || (parts.CPU || {}).display
        || "CPU");
      const isNoGpu = pkg.gpu === "无卡" || pkg.gpu === "无" || (parts.显卡 || {}).id === "0";
      let gpuText = isNoGpu ? "无卡" : (pkg.gpu || (parts.显卡 || {}).display || "显卡");
      if (!isNoGpu && pkg.vram && pkg.vram !== "无" && !String(gpuText).includes(pkg.vram)) {
        gpuText = `${gpuText} ${pkg.vram}`;
      }
      gpuText = compactGpuText(gpuText);
      const memory = compactPartCapacity(pkg, "内存") || "内存";
      const storage = compactPartCapacity(pkg, "硬盘") || "固态";
      const version = String(pkg.version || "").trim();
      const body = `${cpu}+${gpuText}+${memory}+${storage}`;
      return `${arabicConfigName(pkg.name) || "配置"}：${version ? `${body}丨${version}` : body}`;
    }


export function suggestedName(c,format="compact") { const parts=Object.fromEntries(c.parts.map(p=>[p.slot,{id:p.goodsId||"0",display:p.name,qty:p.qty}])); const g=parts.显卡?.id!=="0" ? gpuInfo(parts.显卡?.display||"") : {model:"无卡",vram:"无"}; const pkg={name:c.name,version:c.version,parts,cpuShort:shortCpu(parts.CPU?.display||""),gpu:g.model,vram:g.vram,erpConfigNameRaw:""}; return format==="compact"?compactErpConfigName(pkg):normalizedErpConfigName(pkg); }
