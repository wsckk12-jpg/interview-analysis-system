require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs   = require('fs');
const path = require('path');
const { analyzeInterview } = require('../src/analyze');
const { generateReport }   = require('../src/generateReport');

// ── Sample transcript ────────────────────────────────────────────
const TRANSCRIPT = `
访谈者：张先生，您好，感谢您今天接受我们的访谈。能跟我们讲讲您这次买房的经历吗？

张先生：好的。我们家是我、我老婆还有一个7岁的孩子，现在住的是租的房子，住了3年了，感觉要稳定下来了，就想买房。我在IT公司做产品经理，老婆在学校当老师，两个人加起来月收入大概35000左右。

访谈者：您的预算大概是多少？

张先生：总价在400万到450万之间，不能再高了，首付能拿出来150万，剩下贷款。

访谈者：买房您最看重什么？

张先生：学区最重要，这个是底线，不能让步的。孩子明年要上小学了，一定要在好的学区。其次是我的通勤，我每天要去陆家嘴上班，通勤最好不超过一个小时。面积嘛三室就够了，不用太大。

访谈者：您是怎么开始找房子的？

张先生：最开始在贝壳上自己搜，搜了好多，眼睛都花了。后来用了Deepseek帮我分析不同区域的学区情况，它给了我一些参考，说张江这边的学区比金桥稳一点。然后朋友推荐了你们平台，说服务比较专业。

访谈者：看了哪些区域，最后怎么缩小范围的？

张先生：主要看了浦东的张江和金桥，还有浦西的长宁区。长宁学区也不错，但是离公司太远，通勤要一个半小时，放弃了。金桥看了几套，觉得学区不如张江稳定，最后就集中在张江了。

访谈者：总共看了多少套？

张先生：大概看了15套，前后将近两个月。最开始想买满五唯一的，省税费，但这类房子量少，等了一个月没合适的，后来就放弃这个要求了。

访谈者：最后是怎么定下来的？

张先生：定的是张江一套三室，118平，成交价430万，比我们预期多了30万。这套房子学区属于强学区，小区环境也不错，孩子可以在楼下玩。老婆一开始觉得厨房小了点，有点不满意，但经纪人说这个学区的房子不容易等，而且最近有几组客户也在看，我们就商量了一下咬牙定了。老婆还是有一点保留意见，但基本接受了。

访谈者：对我们的服务有什么想法？

张先生：经纪人小李人很好，带我们看了很多套，也很耐心，比较专业。就是有一次安排我们去看一套房，结果到了发现已经卖掉了，浪费了一趟时间，这个信息同步可以更及时一点。另外签合同的时候有些条款我看不太懂，希望能有人详细解释一下，不能只是让我们自己看。

访谈者：好的，非常感谢您的分享！
`.trim();

const INSTRUCTION = '重点关注客户对学区的态度，以及AI工具在决策中的作用';
const OUTPUT_DIR  = path.join(__dirname, 'output');

// ── Helpers ──────────────────────────────────────────────────────
function pass(msg)  { console.log(`  ✓ ${msg}`); }
function fail(msg)  { console.error(`  ✗ ${msg}`); }

function checkKeys(obj, keys, label) {
  const missing = keys.filter(k => obj[k] === undefined);
  if (missing.length) {
    fail(`${label} missing keys: ${missing.join(', ')}`);
    return false;
  }
  pass(`${label} has all expected keys`);
  return true;
}

// ── Main ─────────────────────────────────────────────────────────
(async () => {
  console.log('\n=== Interview Analysis System — Integration Test ===\n');

  // Pre-flight: env vars
  console.log('[ env ]');
  let envOk = true;
  if (!process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY.startsWith('sk-xxx')) {
    fail('DEEPSEEK_API_KEY not set — add it to .env');
    envOk = false;
  } else {
    pass('DEEPSEEK_API_KEY present');
  }
  if (!envOk) process.exit(1);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // ── Step 1: Analyze ──────────────────────────────────────────
  console.log('\n[ step 1 / 2 ]  analyzeInterview');
  const t0 = Date.now();
  let analysis;
  try {
    analysis = await analyzeInterview(TRANSCRIPT, INSTRUCTION);
    pass(`DeepSeek responded in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (err) {
    fail(`analyzeInterview threw: ${err.message}`);
    process.exit(1);
  }

  // Validate top-level shape
  const TOP_KEYS = ['clientInfo', 'section1_needs', 'section2_decision',
                    'section3_experience', 'section4_process', 'coreSummary'];
  checkKeys(analysis, TOP_KEYS, 'analysis root');

  if (analysis.clientInfo) {
    checkKeys(analysis.clientInfo, ['name', 'city', 'budget'], 'clientInfo');
  }
  if (analysis.section2_decision) {
    const s2 = analysis.section2_decision;
    const hasScores = s2.consistencyScore != null && s2.autonomyScore != null;
    hasScores ? pass('both scores present') : fail('one or both scores missing');
    if (hasScores) {
      const inRange = v => typeof v === 'number' && v >= 0 && v <= 100;
      inRange(s2.consistencyScore) && inRange(s2.autonomyScore)
        ? pass(`scores in range  —  一致性 ${s2.consistencyScore}  自主性 ${s2.autonomyScore}`)
        : fail(`scores out of range: ${s2.consistencyScore}, ${s2.autonomyScore}`);
    }
  }
  if (analysis.coreSummary) {
    pass(`coreSummary: "${analysis.coreSummary.slice(0, 60)}…"`);
  }

  // ── Step 2: Generate Word ────────────────────────────────────
  console.log('\n[ step 2 / 2 ]  generateReport');
  const t1 = Date.now();
  let buffer;
  try {
    buffer = await generateReport(analysis);
    pass(`Buffer generated in ${((Date.now() - t1) / 1000).toFixed(1)}s  (${(buffer.length / 1024).toFixed(0)} KB)`);
  } catch (err) {
    fail(`generateReport threw: ${err.message}`);
    process.exit(1);
  }

  // Validate it's a real OOXML zip (starts with PK)
  const magic = buffer[0] === 0x50 && buffer[1] === 0x4b;
  magic ? pass('Buffer is valid OOXML (PK header)') : fail('Buffer does not look like a ZIP/DOCX');

  const outPath = path.join(OUTPUT_DIR, 'test-report.docx');
  fs.writeFileSync(outPath, buffer);
  pass(`Saved → ${path.relative(process.cwd(), outPath)}`);

  // ── Summary ──────────────────────────────────────────────────
  const total = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n=== All checks passed  (${total}s total) ===\n`);
})();
