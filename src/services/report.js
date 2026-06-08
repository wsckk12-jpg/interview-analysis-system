const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle,
} = require('docx');
const path = require('path');
const fs = require('fs');

function heading1(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 } });
}

function heading2(text) {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 150 } });
}

function body(text) {
  return new Paragraph({ children: [new TextRun({ text, size: 24 })], spacing: { after: 120 } });
}

function bulletItem(label, detail) {
  return new Paragraph({
    children: [
      new TextRun({ text: `• ${label}`, bold: true, size: 24 }),
      new TextRun({ text: detail ? `：${detail}` : '', size: 24 }),
    ],
    spacing: { after: 100 },
    indent: { left: 360 },
  });
}

function scoreRow(label, value) {
  return new TableRow({
    children: [
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 22 })] })],
        width: { size: 30, type: WidthType.PERCENTAGE },
      }),
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: String(value), size: 22 })] })],
        width: { size: 70, type: WidthType.PERCENTAGE },
      }),
    ],
  });
}

async function generateReport({ transcript, analysis, filename }) {
  const {
    summary, candidateProfile, strengths, weaknesses,
    keyAnswers, overallScore, recommendation, nextSteps,
  } = analysis;

  const children = [
    new Paragraph({
      children: [new TextRun({ text: '面试分析报告', bold: true, size: 56 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
    new Paragraph({
      children: [new TextRun({ text: `生成时间：${new Date().toLocaleString('zh-CN')}　　来源文件：${filename}`, size: 20, color: '888888' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }),

    heading1('一、整体概述'),
    body(summary),

    heading1('二、综合评估'),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        scoreRow('候选人画像', candidateProfile),
        scoreRow('综合评分', `${overallScore} / 10`),
        scoreRow('录用建议', recommendation),
      ],
    }),
    new Paragraph({ spacing: { after: 200 } }),

    heading1('三、优势亮点'),
    ...(strengths || []).map(s => bulletItem(s.point, s.detail)),

    heading1('四、不足之处'),
    ...(weaknesses || []).map(w => bulletItem(w.point, w.detail)),

    heading1('五、关键问题分析'),
  ];

  (keyAnswers || []).forEach((qa, i) => {
    children.push(
      heading2(`${i + 1}. ${qa.question}`),
      body(`回答：${qa.answer}`),
      body(`评分：${qa.score}/10　　${qa.comment}`),
    );
  });

  children.push(
    heading1('六、后续建议'),
    body(nextSteps),
    heading1('七、原始转写'),
    new Paragraph({
      children: [new TextRun({ text: transcript, size: 20, color: '555555' })],
      spacing: { after: 200 },
    }),
  );

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: 'Microsoft YaHei', size: 24 } },
      },
    },
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(doc);
  const outPath = path.join(__dirname, '../../reports', `report-${Date.now()}.docx`);
  fs.writeFileSync(outPath, buffer);
  return outPath;
}

module.exports = { generateReport };
