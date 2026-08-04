# Progress timeline

`createProgressTimeline` renders ordered, nested progress without owning any domain state. Callers project capability, tool, skill, or media-generation events into `ProgressTimelineItem[]` and update the same instance with `setItems`.

The component distinguishes pending, running, completed, failed, cancelled, and skipped work. `children` provide the sub-item lineage beneath a broader operation. Labels use the surrounding surface's normal text weight and never reserve a right-side counter column. Running markers use the two-layer expanding ripple from Lixpi's product timeline; its phase is anchored to a shared clock so replacing streamed DOM does not visibly restart the animation.
