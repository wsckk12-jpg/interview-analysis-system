const {
  Document, Packer, Paragraph, TextRun,
  Table, TableRow, TableCell,
  WidthType, AlignmentType, ShadingType, BorderStyle,
} = require('docx');

const DARK_BLUE = '1F3864';
const LIGHT_BLUE = 'BDD7EE';
const MID_BLUE  = '2E5FAC';
const GRAY      = '767676';
const FONT      = 'Arial';

// ----------------------------------------------------------------
// Element builders
// ----------------------------------------------------------------

function sectionHeading(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, color: DARK_BLUE, size: 28, font: FONT })],
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: DARK_BLUE } },
    spacing: { before: 480, after: 200 },
  });
}

function subHeading(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, color: MID_BLUE, size: 24, font: FONT })],
    spacing: { before: 280, after: 120 },
  });
}

function bodyPara(text) {
  if (!text || text === 'null') return null;
  return new Paragraph({
    children: [new TextRun({ text: String(text), size: 22, font: FONT })],
    spacing: { after: 120 },
  });
}

function spacer() {
  return new Paragraph({ spacing: { after: 160 } });
}

function headerCell(text, widthPct) {
  return new TableCell({
    width: widthPct ? { size: widthPct, type: WidthType.PERCENTAGE } : undefined,
    shading: { fill: LIGHT_BLUE, type: ShadingType.CLEAR, color: 'auto' },
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text, bold: true, size: 20, font: FONT })],
    })],
  });
}

function dataCell(text) {
  const safe = (text == null || text === 'null') ? '' : String(text);
  return new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text: safe, size: 20, font: FONT })],
    })],
  });
}

function makeTable(headers, rows, colWidths) {
  if (!rows?.length) return null;
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) => headerCell(h, colWidths?.[i])),
      }),
      ...rows.map(row => new TableRow({
        children: row.map(cell => dataCell(cell)),
      })),
    ],
  });
}

function scoreRow(label, score, note) {
  const parts = [
    new TextRun({ text: `${label}：`, bold: true, size: 22, font: FONT }),
    new TextRun({ text: `${score ?? '—'} 分`, bold: true, size: 26, color: DARK_BLUE, font: FONT }),
  ];
  if (note && note !== 'null') {
    parts.push(new TextRun({ text: `　${note}`, size: 20, color: GRAY, font: FONT }));
  }
  return new Paragraph({ children: parts, spacing: { after: 140 } });
}

function bulletList(items) {
  if (!items?.length) return [];
  return items.filter(s => s && s !== 'null').map(s =>
    new Paragraph({
      children: [new TextRun({ text: `• ${s}`, size: 22, font: FONT })],
      indent: { left: 360 },
      spacing: { after: 80 },
    })
  );
}

// Push non-null into array (supports nested arrays)
function push(arr, ...items) {
  for (const item of items.flat()) {
    if (item != null) arr.push(item);
  }
}

// ----------------------------------------------------------------
// Main
// ----------------------------------------------------------------

async function generateReport(analysis) {
  const {
    clientInfo,
    section1_needs    : s1,
    section2_decision : s2,
    section3_experience: s3,
    section4_process  : s4,
    coreSummary,
  } = analysis;

  const children = [];

  // ── Title ──────────────────────────────────────────────────────
  push(children,
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      children: [new TextRun({ text: '客户访谈分析报告', bold: true, size: 52, color: DARK_BLUE, font: FONT })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 560 },
      children: [new TextRun({ text: `生成时间：${new Date().toLocaleString('zh-CN')}`, size: 18, color: GRAY, font: FONT })],
    }),
  );

  // ── 客户基本信息 ────────────────────────────────────────────────
  if (clientInfo) {
    const rows = [
      ['姓名', clientInfo.name],
      ['城市', clientInfo.city],
      ['家庭情况', clientInfo.familyStructure],
      ['职业', clientInfo.work],
      ['收入', clientInfo.income],
      ['预算', clientInfo.budget],
    ].filter(([, v]) => v && v !== 'null');

    if (rows.length) {
      push(children, sectionHeading('客户基本信息'));
      push(children, makeTable(['项目', '信息'], rows, [25, 75]));
      push(children, spacer());
    }
  }

  // ── 维度一：需求分析 ────────────────────────────────────────────
  if (s1?.background || s1?.priorityTable?.length || s1?.verification) {
    push(children, sectionHeading('维度一：需求分析'));
    push(children, bodyPara(s1.background));

    if (s1.priorityTable?.length) {
      push(children, subHeading('需求优先级'));
      push(children, makeTable(
        ['排序', '在意什么', '具体要求', '能否让步'],
        s1.priorityTable.map(r => [r.rank, r.need, r.detail, r.flexible]),
        [10, 25, 40, 25],
      ));
      push(children, spacer());
    }

    if (s1.verification && s1.verification !== 'null') {
      push(children, subHeading('行为与口头需求的对比'));
      push(children, bodyPara(s1.verification));
    }
  }

  // ── 维度二：决策分析 ────────────────────────────────────────────
  if (s2) {
    const hasContent = s2.decisionMakers || s2.consistencyTable?.length
      || s2.consistencyScore != null || s2.externalFactors || s2.autonomyScore != null;

    if (hasContent) {
      push(children, sectionHeading('维度二：决策分析'));

      if (s2.decisionMakers && s2.decisionMakers !== 'null') {
        push(children, subHeading('谁说了算'));
        push(children, bodyPara(s2.decisionMakers));
      }

      if (s2.consistencyTable?.length) {
        push(children, subHeading('言行一致性'));
        push(children, makeTable(
          ['客户说的', '最终选的', '是否一致'],
          s2.consistencyTable.map(r => [r.stated, r.actual, r.match]),
          [40, 40, 20],
        ));
        push(children, spacer());
      }

      if (s2.consistencyScore != null) {
        push(children, scoreRow('需求一致性', s2.consistencyScore, s2.consistencyNote));
      }

      if (s2.externalFactors && s2.externalFactors !== 'null') {
        push(children, subHeading('外部影响因素'));
        push(children, bodyPara(s2.externalFactors));
      }

      if (s2.autonomyScore != null) {
        push(children, scoreRow('决策自主性', s2.autonomyScore, s2.autonomyNote));
      }
    }
  }

  // ── 维度三：体验复盘 ────────────────────────────────────────────
  if (s3) {
    const phases = [
      ['找房阶段', s3.searchPhase],
      ['看房阶段', s3.viewingPhase],
      ['成交阶段', s3.closingPhase],
      ['客户批评与不满', s3.criticism],
    ].filter(([, v]) => v && v !== 'null');

    if (phases.length) {
      push(children, sectionHeading('维度三：体验复盘'));
      for (const [label, text] of phases) {
        push(children, subHeading(label), bodyPara(text));
      }
    }
  }

  // ── 维度四：过程回顾 ────────────────────────────────────────────
  if (s4) {
    const stages = [
      ['初筛阶段', s4.screening],
      ['聚焦阶段', s4.focusing],
      ['收口阶段', s4.closing],
    ].filter(([, v]) => v && v !== 'null');
    const hasContent = stages.length || s4.turningPoints?.length;

    if (hasContent) {
      push(children, sectionHeading('维度四：过程回顾'));
      for (const [label, text] of stages) {
        push(children, subHeading(label), bodyPara(text));
      }
      if (s4.turningPoints?.length) {
        push(children, subHeading('关键转折点'));
        push(children, ...bulletList(s4.turningPoints));
      }
    }
  }

  // ── 核心发现 ────────────────────────────────────────────────────
  if (coreSummary && coreSummary !== 'null') {
    push(children, sectionHeading('核心发现'));
    push(children, bodyPara(coreSummary));
  }

  const doc = new Document({
    styles: {
      default: { document: { run: { font: FONT, size: 22 } } },
    },
    sections: [{ children }],
  });

  return Packer.toBuffer(doc);
}

module.exports = { generateReport };
