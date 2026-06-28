VideoPilot API suite enables users to transform reference videos/images into videos through prompting. Meanwhile, users can apply constraints or guidance to key parameters of the recreated videos, including scene, character, motion, style, and camera settings. In addition, the API suite allows for refining the quality by using feedback with prompting as it regenerates a specific video segment based on user feedback to improve quality or alignment with user intents.

<span id="015e259d"></span>
# Endpoints

<span id="8e9be93e"></span>
## **ImitateAndGenerateVideo**

Generates a new video based on a reference video and optional reference images, following the user’s edit instruction.

<span id="be217919"></span>
### **Parameters**


|**Name** |**Type** |**Required** |**Description** |
|---|---|---|---|
|RefVideoUrl |string |✅ |URL to the reference video that defines motion, rhythm, or style to imitate. |
|UserMessage |string |✅ |User prompt describing the desired transformation or concept (e.g., “make it look like a night scene in neon city”). |
|RefImages |list |Optional (≤ 1) |One reference image URL to guide appearance, tone, or identity (will expand to 2 reference images soon) |
|Model |string |Optional |Specifies which model to use for generation; currently supports seedance\-1\-0\-pro\-250528 |
|TimeBudget |integer |Optional (1, 2, or 3) |Allocated compute or quality level. Higher values allow longer/better results. |
|VideoRatio |string |Optional |Video aspect ratio (e.g., '1:1', '16:9') |
|VideoResolution |string |Optional |Video resolution (e.g., '1080p', '720p') |
|ImitationSetting |string |Optional |Imitation strategy, e.g. 'imitative' or 'creative' |


<span id="b99a922f"></span>
### **Response**


|**Field** |**Type** |**Description** |
|---|---|---|
|TaskId |string |Unique identifier of the asynchronous video generation task. |


Example API Usage

```Bash
curl --location "https://prompt-pilot.ap-southeast.bytepluses.com/video-pilot?Version=1.0&Action=ImitateAndGenerateVideo" \
--header "Authorization: Bearer {VIDEO_PILOT_API_KEY}" \
--header "Content-Type: application/json" \
--data '{
    "RequestId": "'$(uuidgen)'",
    "WorkspaceId": "{VIDEO_PILOT_WORKSPACE_ID}",
    "RefVideoUrl": "https://link/to/your/video/ or data:video/mp4;base64,...",
    "UserMessage": "Anime Girl Instead",
    "RefImages": ["data:image/png;base64,..."],
    "Model": "seedance-1-0-pro-250528",
    "TimeBudget": 2,
    "VideoRatio": "16:9",
    "VideoResolution": "1080p"
}'
```


Example Return

```Plain
{"Result":{"TaskId":"vgt-2025103112362-ASDFG"},"Error":null}
```


<span id="62292d35"></span>
## **GetTaskResult**

Retrieves the generated results of a completed task.

<span id="cbcac978"></span>
### **Parameters**


|**Name** |**Type** |**Required** |**Description** |
|---|---|---|---|
|TaskId |string |✅ |ID of the task to query. |


<span id="05b733d3"></span>
### **Response**

TaskObject:


|**Field** |**Type** |**Description** |
|---|---|---|
|TaskId |str |TaskId |
|VideoSegments |list |List of generated video segments. |
|FullVideo |str |Video Url of the full video |
|TaskStatus |str |status of the task |


<span id="a58b8871"></span>
#### **VideoSegmentObject**


|**Field** |**Type** |**Description** |
|---|---|---|
|SegmentId |str |unique identifier |
|IndexInVideo |integer |Position of the segment within the overall video. |
|VideoURL |string |URL of the generated video segment. |
|KeyframeURL |string |URL of the representative keyframe image for this segment. |
|ScenePrompt |string |Automatically generated or refined prompt describing the scene. |
|VersionNum |int |The version number of the current segment |


Example API Usage

```Bash
curl --location "https://prompt-pilot.ap-southeast.bytepluses.com/video-pilot?Version=1.0&Action=GetTaskResult" \
--header "Authorization: Bearer {VIDEO_PILOT_API_KEY}" \
--header "Content-Type: application/json" \
--data '{
    "RequestId": "'$(uuidgen)'",
    "WorkspaceId": "{VIDEO_PILOT_WORKSPACE_ID}",
    "TaskId": "Your Task ID"
}'
```


Example Return \- Pending

```Plain
{"Result":{"TaskId":"Your Task ID","FullVideo":"","TaskStatus":"pending","VideoSegments":[]},"Error":null}
```


Example Return \- Finished

```Plain
{
  "Result": {
    "TaskId": "vgt-2025103112362-ASDFG",
    "FullVideo": "Video URL",
    "TaskStatus": "completed",
    "VideoSegments": [
      {
        "SegmentId": "vpv-2025104536724-ABCDE",
        "IndexInVideo": 0,
        "VideoURL": "Video URL",
        "KeyframeURL": "Keyframe URL",
        "ScenePrompt": "Your scene script",
        "VersionNum": 1
      },
      {
        "SegmentId": "vpv-20251031150729-3Au32",
        "IndexInVideo": 1,
        "VideoURL": "Video URL",
        "KeyframeURL": "Keyframe URL",
        "ScenePrompt": "Your scene script",
        "VersionNum": 1
      }
    ]
  },
  "Error": null
}
```


<span id="33e66ba1"></span>
## **ListSegmentVersions**

Retrieves all historical or alternative versions of a specific video segment, such as those generated through multiple iterations or regenerations.

**Parameters**


|**Name** |**Type** |**Required** |**Description** |
|---|---|---|---|
|TaskId |string |✅ |The original task ID associated with the video. |
|SegmentIndex |integer |✅ |index used to find the versioned segments. |


**Response**


|**Field** |**Type** |**Description** |
|---|---|---|
|VideoSegments |list<video_segment\> |List of video segments according to the index. |


Example API Usage

```Bash
curl --location "https://prompt-pilot.ap-southeast.bytepluses.com/video-pilot?Version=1.0&Action=ListSegmentVersions" \
--header "Authorization: Bearer {VIDEO_PILOT_API_KEY}" \
--header "Content-Type: application/json" \
--data '{
    "RequestId": "'$(uuidgen)'",
    "WorkspaceId": "{VIDEO_PILOT_WORKSPACE_ID}",
    "TaskId": "Your TaskId",
    "SegmentIndex": 0
}'
```


Example Return

```Plain
{
  "Result": {
    "VideoSegments": [
      {
        "SegmentId": "vpv-2025104536724-ABCDE",
        "IndexInVideo": 0,
        "VideoURL": "Video URL",
        "KeyframeURL": "Keyframe URL",
        "ScenePrompt": "Your scene script",
        "VersionNum": 1
      },
      {
        "SegmentId": "vpv-20251031150729-3Au32",
        "IndexInVideo": 0,
        "VideoURL": "Video URL",
        "KeyframeURL": "Keyframe URL",
        "ScenePrompt": "Your scene script",
        "VersionNum": 2
      }
    ]
  },
  "Error": null
}
```


<span id="1a2be97a"></span>
## **ListTask**

Lists all existing task IDs for the current user/session.

<span id="1cb74a9c"></span>
### **Parameters**

None.

<span id="37e4c671"></span>
### **Response**


|**Field** |**Type** |**Description** |
|---|---|---|
|Tasks |list |All task identifiers owned by the user. |


Example API Usage

```Bash
curl --location "https://prompt-pilot.ap-southeast.bytepluses.com/video-pilot?Version=1.0&Action=ListTask" \
--header "Authorization: Bearer {VIDEO_PILOT_API_KEY}" \
--header "Content-Type: application/json" \
--data '{
    "RequestId": "'$(uuidgen)'",
    "WorkspaceId": "{VIDEO_PILOT_WORKSPACE_ID}"
}'
```


Example Return

```Plain
{
  "Result": {
    "Tasks": [
      {
        "TaskId": "vgt-20251120191558-ASDFG",
        "FullVideo": "Full Video URL",
        "TaskStatus": "completed",
        "VideoSegments": null
      },
      {
        "TaskId": "vgt-20251120191600-ASDFG",
        "FullVideo": "Full Video URL",
        "TaskStatus": "completed",
        "VideoSegments": null
      },
      {
        "TaskId": "vgt-20251120191615-8yM8X",
        "FullVideo": "",
        "TaskStatus": "failed",
        "VideoSegments": null
      }
    ]
  },
  "Error": null
}
```


<span id="107705be"></span>
## **RegenerateVideoSegmentFromFeedback**

Regenerates a specific video segment based on user feedback, improving quality or alignment with intent.

<span id="92ca3f8b"></span>
### **Parameters**


|**Name** |**Type** |**Required** |**Description** |
|---|---|---|---|
|TaskId |string |✅ |The original task ID associated with the video. |
|SegmentId |string |✅ |The segment ID used as the base version for regeneration. |
|FeedbackMessage |string |✅ |User feedback describing what to change (e.g., “make lighting softer and add fog”). |


<span id="93068c5e"></span>
### **Response**


|**Field** |**Type** |**Description** |
|---|---|---|
|TaskId |string |New task ID for the regeneration job. |


Example API Usage

```Bash
curl --location "https://prompt-pilot.ap-southeast.bytepluses.com/video-pilot?Version=1.0&Action=RegenerateVideoSegmentFromFeedback" \
--header "Authorization: Bearer {VIDEO_PILOT_API_KEY}" \
--header "Content-Type: application/json" \
--data '{
    "RequestId": "'$(uuidgen)'",
    "WorkspaceId": "{VIDEO_PILOT_WORKSPACE_ID}",
    "TaskId": "Your TaskId",
    "FeedbackMessage": "Add floating cats",
    "SegmentId": "Get it from get task result"
}'
```


Example Return

```Plain
{"Result":{"TaskId":"Your Task ID"},"Error":null}
```


<span id="dee0d885"></span>
## ExtractKeyFramesAndPlot

This API is designed to build a Prompt library for popular videos by extracting key frames and plot sources.

<span id="41cf37ca"></span>
### Parameters


* `VideoURL`: Downloadable URL (e.g. from tos) or base64 content.


<span id="d20c12f3"></span>
### Response


|**Name** |**Type** |**Required** |**Description** |
|---|---|---|---|
|TaskId |string |✅ |ID of the task to query. |


<span id="b1f06706"></span>
## GetExtractKeyFramesAndPlotResult

<span id="d62ea22a"></span>
### Parameters


|**Name** |**Type** |**Required** |**Description** |
|---|---|---|---|
|TaskId |string |✅ |ID of the task to query. |


<span id="17453a9b"></span>
### Response

The response is a structure that includes the **first frame**, **last frame**, and prompt of each video segment.


|**Field** |**Type** |**Description** |
|---|---|---|
|VideoSegments |list |List of video segments according to the index. |
|TaskStatus |str |Task Status |


RefVideoSegmentObject


|**Field** |**Type** |**Description** |
|---|---|---|
|SegmentId |str |unique identifier |
|IndexInVideo |integer |Position of the segment within the overall video. |
|VideoURL |string |URL of the generated video segment. |
|KeyframeURL |string |URL of the representative keyframe image for this segment. |
|ScenePrompt |string |Automatically generated or refined prompt describing the scene. |
|LastframeURL |string |URL of the last frame image for this segment. |


<span id="43e7343b"></span>
# Typical Usage


1. To generate a video through **batch imitation**, use `imitate_and_generate_video`.

   This API reproduces the reference video’s details while applying your provided instructions to create a new video.

   For best results, include a **reference image** to guide visual style or identity.

   Once the task is complete, retrieve the generated output using `get_task_result`.

2. To **fine\-tune or improve specific parts** of the generated video, use `regenerate_video_segment_from_feedback`.

   This endpoint accepts user feedback and re\-generates only the selected segment, refining it based on your input.

   It is especially useful for **challenging video sections** that require multiple **trial\-and\-error iterations** to achieve the desired result.


<span id="4852ba72"></span>
## AgenticShortVideoGeneration

Agentic Short Video Generation to automatically handle multiple reference images for video generation.

<span id="54a5fe9e"></span>
### Parameters


|**Name** |**Type** |**Required** |**Description** |
|---|---|---|---|
|UserMessage |string |✅ |User prompt describing the desired transformation or concept (e.g., “make it look like a night scene in neon city”). |
|RefImages |list |Optional (≤ 2) |Up to 2 reference image URLs to guide appearance, tone, or identity (will extend to more reference images soon) |
|Model |string |Optional |Specifies which model to use for generation; currently supports seedance\-1\-0\-pro\-250528 |
|VideoRatio |string |Optional |Video aspect ratio (e.g., '1:1', '16:9') |
|VideoResolution |string |Optional |Video resolution (e.g., '1080p', '720p') |
|Duration |int |Optional (Default is 5) |Video duration in seconds |


<span id="12d7688e"></span>
### Response

The response is a structure that includes the **first frame**, **last frame**, and prompt of each video segment.


|**Field** |**Type** |**Description** |
|---|---|---|
|TaskId |string |Unique identifier of the asynchronous video generation task. |


<span id="3a97a204"></span>
# Future supports


1. Insert keyframe and splitting videos

2. Version management

3. More controllable parameters for **imitate_and_generate_video**


```Bash
#!/bin/bash

# Video Pilot API Curl Commands
# Set your environment variables first:
export VIDEO_PILOT_API_URL="https://prompt-pilot.cn-beijing.volces.com"
export VIDEO_PILOT_API_KEY="your_api_key"
export VIDEO_PILOT_WORKSPACE_ID="your workspace id"

# 1. ImitateAndGenerateVideo - Generate a new video based on a reference video
curl --location "$VIDEO_PILOT_API_URL/video-pilot?Version=1.0&Action=ImitateAndGenerateVideo" \
--header "Authorization: Bearer $VIDEO_PILOT_API_KEY" \
--header "Content-Type: application/json" \
--data '{
    "RequestId": "'$(uuidgen)'",
    "WorkspaceId": "'$VIDEO_PILOT_WORKSPACE_ID'",
    "RefVideoUrl": "https://link/to/your/video/ or data:video/mp4;base64,...",
    "UserMessage": "Anime Girl Instead",
    "RefImages": ["data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="],
    "Model": "seedance-1-0-pro-250528",
    "TimeBudget": 2,
    "VideoRatio": "16:9",
    "VideoResolution": "1080p"
}'

# 2. GetTaskResult - Retrieve the results of a completed task
export task_id="ta-20250904134351-AUtEk"

curl --location "$VIDEO_PILOT_API_URL/video-pilot?Version=1.0&Action=GetTaskResult" \
--header "Authorization: Bearer $VIDEO_PILOT_API_KEY" \
--header "Content-Type: application/json" \
--data '{
    "RequestId": "'$(uuidgen)'",
    "WorkspaceId": "'$VIDEO_PILOT_WORKSPACE_ID'",
    "TaskId": "'$task_id'"
}'

# 3. ListSegmentVersions - Get all versions of a specific video segment
export segment_index=0

curl --location "$VIDEO_PILOT_API_URL/video-pilot?Version=1.0&Action=ListSegmentVersions" \
--header "Authorization: Bearer $VIDEO_PILOT_API_KEY" \
--header "Content-Type: application/json" \
--data '{
    "RequestId": "'$(uuidgen)'",
    "WorkspaceId": "'$VIDEO_PILOT_WORKSPACE_ID'",
    "TaskId": "'$task_id'",
    "SegmentIndex": '$segment_index'
}'

# 4. RegenerateVideoSegmentFromFeedback - Regenerate a segment based on feedback
export segment_id="abcd1234"

curl --location "$VIDEO_PILOT_API_URL/video-pilot?Version=1.0&Action=RegenerateVideoSegmentFromFeedback" \
--header "Authorization: Bearer $VIDEO_PILOT_API_KEY" \
--header "Content-Type: application/json" \
--data '{
    "RequestId": "'$(uuidgen)'",
    "WorkspaceId": "'$VIDEO_PILOT_WORKSPACE_ID'",
    "TaskId": "'$task_id'",
    "SegmentId": '$segment_id',
    "FeedbackMessage": "Make the lighting softer and add more motion blur"
}'
```




