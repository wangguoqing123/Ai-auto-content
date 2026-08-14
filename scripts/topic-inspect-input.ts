import { loadTopicIntelligenceConfig } from '../src/topic-intelligence/config.js';
import { buildTopicMaterialInput } from '../src/topic-intelligence/material-input.js';

const prefix = '--date=';
const date = process.argv.slice(2).find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
  ?? new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
try {
  const config = await loadTopicIntelligenceConfig();
  const input = await buildTopicMaterialInput(process.cwd(), date, config);
  console.log(JSON.stringify({
    decision_date: date,
    input_summary: input.summary,
    materials: input.cards.map((card) => ({
      material_id: card.material_id,
      source_platform: card.source_platform,
      role: card.role,
      title: card.title,
      canonical_url: card.role === 'restricted_inspiration_only' ? null : card.canonical_url,
      published_at: card.published_at,
      published_at_quality: card.published_at_quality,
      restrictions: card.restrictions,
    })),
  }, null, 2));
} catch {
  console.error(JSON.stringify({ status: 'failed', error_code: 'file_read_failed', error_message_safe: 'Input inspection failed.' }));
  process.exitCode = 4;
}
