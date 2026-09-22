# Personal reports

Read this format for daily, weekly and monthly report tasks. These are personal reports, not employee work reports. Include evidenced personal projects, professional activities, learning, reading and knowledge organization equally. Do not invent life activities absent from the input, or impose work-specific headings such as workload, manager update or tomorrow's work plan.

The platform supplies `period`, inclusive `range.start` / `range.end`, events, sources and entity names in `input.json`. Daily reports cover one local calendar day; weeks run Monday through Sunday, months use the calendar month. Do not infer occurrence dates from scan times. Weekly/monthly reports synthesize this period's actual events directly; do not concatenate daily reports or count the same activity twice. For an unfinished week/month, describe only recorded progress, not future days.

Return exactly the provided JSON schema:

```json
{
  "items": [
    {
      "summary": "完善个人阅读工具，支持长文目录定位。",
      "details": [
        {
          "text": "为 Markdown 阅读器增加标题目录与锚点定位，修复长文滚动后目录选中项不同步的问题；已通过类型检查。",
          "evidenceIds": ["actual-event-id"]
        }
      ]
    }
  ]
}
```

The example is a format illustration, never a source of facts. Use one item per meaningful topic, normally 1–6; use more only when distinct recorded topics need it. There is no minimum quota of four. Merge related Git and Agent events, preserving meaningful details.

- `summary`: one concise Chinese sentence naming the subject and concrete result/progress. Every claim must be supported by that item's details and evidence. Do not put raw event IDs in prose.
- `details`: concrete actions, affected project/document/component, decisions, fixes, actual validation and remaining issues if recorded. Explain more than the summary; do not merely rephrase it. Use several details if evidence warrants it. Do not invent metrics, outcomes, causes or future plans. Preserve the distinction between completed, in progress and failed.
- Each detail's `evidenceIds` must copy exact `events[].id` values from this task's input. The output schema enumerates those permitted IDs. Do not substitute source IDs, entity IDs or Git hashes, or reconstruct an ID from memory. Exclude unrelated citations. Source names and paths are context, never proof of an activity. Never attribute other people's commits or Git pull operations to the user.
- Text fields contain prose, without Markdown headings or manual numbering. The application owns formatting and renders readable source descriptions; IDs are retained internally.

The application renders this fixed structure for every report:

```markdown
# <date or date range> 个人日报 / 个人周报 / 个人月报

## 内容概览

1. <first summary>
2. <second summary>

## 详细内容

### 1. <first summary>

- <specific action and result>
  - 依据：<readable project/document and recorded event description>

### 2. <second summary>

- <specific action and result>
  - 依据：<readable evidence>
```

When no eligible records exist, the platform writes the same two sections with an empty-period message without calling an agent. Absence of a record does not mean the person did nothing. Do not generate filler, mandatory plans or unsupported achievements. Report tasks only return structured output: do not execute commands, record new events or edit report files.
