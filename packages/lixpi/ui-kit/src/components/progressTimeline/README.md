# Progress timeline

`createProgressTimeline` renders ordered, nested progress without owning any domain state. Callers project capability, tool, skill, or media-generation events into `ProgressTimelineItem[]` and update the same instance with `setItems`.

The component distinguishes pending, running, completed, attention, failed, cancelled, and skipped work. `children` provide the sub-item lineage beneath a broader operation. Running items always expose their live summaries. Attention, failed, and cancelled items open automatically so their result is surfaced, but the user can collapse them manually; that choice survives streamed updates. Clean completed items collapse by default, while pending and skipped details remain manually expandable. Disclosure state survives streamed DOM replacement when the caller supplies a stable `rippleClockId`.

Labels use the surrounding surface's normal text weight. Optional `meta` text keeps a compact result such as an overall score visible even while details are collapsed. Running markers use the same three-path SVG and staggered D3 expansion used by the product graph: the middle layer expands to 1.72×, the outer ring follows after 220 ms and expands to 2.05×, and the center remains fixed. `createProgressRippleIcon` is exported for other UI-kit consumers that need the same active marker.
