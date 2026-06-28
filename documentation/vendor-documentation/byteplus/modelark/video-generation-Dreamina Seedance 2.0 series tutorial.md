Dreamina Seedance 2.0 series (hereinafter referred to as Seedance 2.0 series) models support multimodal input such as images, videos, audios and texts, with capabilities including video generation, video editing, and video extension. They can restore item details, timbres, effects, styles, camera movements and more with high accuracy, maintain consistent character features, and give users enterprise\-grade control. This topic introduces the exclusive capabilities of the Seedance 2.0 series models to help you get started quickly.

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">Before enabling the Dreamina Seedance 2.0 models, please ensure that you have purchased a Dreamina Seedance 2.0 series resource package with available balance.</div>


<div data-tips="true" data-tips-type="tip">For detailed rules, see <a href="https://docs.byteplus.com/en/docs/ModelArk/2191775">Resource packs for Dreamina Seedance 2.0 series models</a>.</div>


<span id="e000144b"></span>
# Getting started

This getting started tutorial is designed specifically for **users new to API**, to help you set up a Python development environment, create virtual environments, and install the ModelArk SDK with one click. With the provided out\-of\-the\-box Seedance 2.0 series code samples, you only need to replace the input assets to start your video creation.

<span id="480c43a8"></span>
## **1. Prerequisites**

Before you start, make sure you have completed the following preparations:


1. **Register an account**: Make sure you have a BytePlus account and are [signed in](https://console.byteplus.com/ark/region:ark+ap-southeast-1/overview).

2. **Get API Key**: Visit the [API keys](https://console.byteplus.com/ark/region:ark+ap-southeast-1/apiKey) page, click **Create API Key**, then copy and save your API Key. Make sure to keep your API Key safe and do not disclose it to others.

3. [Activate the models](https://console.byteplus.com/ark/region:ark+ap-southeast-1/openManagement): Please purchase the [prepaid resource packs](https://www.byteplus.com/en/experience/modelark?launch=seedance-2-0) in advance, otherwise you cannot activate Seedance 2.0 series models.

4. **Download and unzip the file**: Click to download the attachment below, and unzip it to your local directory (such as the desktop or "Downloads" folder).

   <Attachment link="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f85a5be8202b45c1bb226669214af8c6~tplv-goo7wpa0wc-image.image" name="modelark_seedance2.0_quickstart_package.zip">modelark_seedance2.0_quickstart_package.zip</Attachment>
   


<span id="54b10004"></span>
## **2. Procedure**


<Tabs>
<Tab zoneid="eLsjEI3lRG" title="Windows users">
<TabTitle>Windows users</TabTitle>

1. Go to the `scripts/init_dev_env` directory.

2. Double\-click to run `setup_windows.bat`.

3. The script will automatically perform the following operations:

   * Download the uv tool.

   * Automatically download Python 3.12 (if it does not interfere with the Python installed in your system).

   * Create the `.venv` virtual environment.

   * Install the ModelArk SDK.

4. After completion, a `run_demo.bat` file will be generated in the project root directory.

5. Double\-click `run_demo.bat` to run the Python SDK code sample (python/demo_standard.py).


</Tab>
<Tab zoneid="aGceCeWzqC" title="macOS users">
<TabTitle>macOS users</TabTitle>

1. Open the terminal and go to the `scripts/init_dev_env` directory.

2. Run the set up script:

   ```Plain
   ./setup_mac.sh
   ```
   

3. The script will automatically configure all environments.

4. After completion, a `run_demo.sh` file will be generated in the project root directory.

5. Run `./run_demo.sh` to run the Python SDK code sample (python/demo_standard.py).


</Tab>
</Tabs>


<span id="46454177"></span>
## **3. What the script does**

After running the script, you will see the following process:


1. **Verify the API Key**: The script will automatically detect whether the `ARK_API_KEY` environment variable is configured locally. If not, you will be prompted to enter it manually.

2. **Preview the assets**: The script will automatically pop up a locally generated HTML page in your default browser, displaying the text prompt for this task, the reference image to be replaced, and the reference video.

3. **Create the task and query for status**: The script initiates an asynchronous request to the ModelArk server. Since video generation takes some time, the console will print the task status (such as `running`) every 30 seconds.

4. **Get the results**: After the task is completed successfully, the console will output the URL of the generated video. You can copy the link to your browser to download or play it online.


<span id="370587e7"></span>
## **4. Next steps**

After you successfully run this sample, you can try to modify `python/demo_standard.py` to create your own video\-generation task:


1. Modify the text prompt.

   Find the `user_content` variable in the code and change it to any description you want.

2. Replace input assets (images, videos, audios).

   You can replace `reference_image_url`, `reference_video_url` and `reference_audio_url` with your own asset links. **Note**: Please make sure the URL is a publicly accessible link on the public network (it is recommended to store it in BytePlus TOS object storage service and configure it for public read access).

3. Continue to explore the following examples.


<span id="fd30cc1a"></span>
# Model capabilities

The Seedance 2.0 series models currently include Dreamina Seedance 2.0 (hereinafter referred to as Seedance 2.0), Dreamina Seedance 2.0 Fast (hereinafter referred to as Seedance 2.0 Fast) and Dreamina Seedance 2.0 Mini (hereinafter referred to as Seedance 2.0 Mini). The three models support largely the same features, with the primary differences being the trade\-off between generation quality and cost:


* For the highest generation quality, use Seedance 2.0.

* For a balance of cost and generation speed when top\-tier quality is not required, use Seedance 2.0 Fast.

* For the best cost performance, use Seedance 2.0 Mini.



<span aceTableMode="list" aceTableWidth="3,3,4,4,"></span>
|Model Name | |[Seedance 2.0](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=dreamina-seedance-2-0) |[Seedance 2.0 Fast](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=dreamina-seedance-2-0-fast) |[Seedance 2.0 Mini](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=dreamina-seedance-2-0-mini) |
|---|---|---|---|---|
|Model ID | |dreamina\-seedance\-2\-0\-260128 |dreamina\-seedance\-2\-0\-fast\-260128 |dreamina\-seedance\-2\-0\-mini\-260615 |
|[Text to video](https://docs.byteplus.com/en/docs/ModelArk/2298881#4e74bcee) | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[Image to video (first frame)](https://docs.byteplus.com/en/docs/ModelArk/2298881#979b2d28) | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[Image to video (first and last frames)](https://docs.byteplus.com/en/docs/ModelArk/2298881#0d55ca07) | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[Multimodal reference](https://docs.byteplus.com/en/docs/ModelArk/2291680#multimodal-reference) [New] |Image reference |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
||Video reference |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
||Combined reference<br><br><br>* Image + audio<br><br>* Image + video<br><br>* Video + audio<br><br>* Image + video + audio |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[Edit video](https://docs.byteplus.com/en/docs/ModelArk/2291680#edit-video) [New] | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[Extend video](https://docs.byteplus.com/en/docs/ModelArk/2291680#extend-video) [New] | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[Generate audio video](https://docs.byteplus.com/en/docs/ModelArk/2298881#979b2d28)<br><br>> "generate_audio": "true" | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[Draft mode](https://docs.byteplus.com/en/docs/ModelArk/2298881#5acd28c8) | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) </span> |
|[Return the last frame of the generated video](https://docs.byteplus.com/en/docs/ModelArk/2298881#141cf7fa)<br><br>> "return_last_frame": "true" | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/ee51ce32c1914aed81ff95080bb7db1d~tplv-goo7wpa0wc-image.image) </span> |
|[Output video specifications](https://docs.byteplus.com/en/docs/ModelArk/2298881#9fe4cce0) |Resolution<br><br>> "resolution": "720p" |480p, 720p, 1080p, 4k (10bit\-encoding) |480p, 720p |480p, 720p |
||Aspect ratio<br><br>> "ratio":"16:9" |21:9, 16:9, 4:3, 1:1, 3:4, 9:16 |21:9, 16:9, 4:3, 1:1, 3:4, 9:16 |21:9, 16:9, 4:3, 1:1, 3:4, 9:16 |
||Duration<br><br>> "duration": 5 |4–15 seconds |4–15 seconds |4–15 seconds |
||Video format |mp4 |mp4 |mp4 |
|[Offline inference](https://docs.byteplus.com/en/docs/ModelArk/2298881#a0badaae)<br><br>> "service_tier": "flex" | |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) </span> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f359753773c94d97885008ca1223c9bc~tplv-goo7wpa0wc-image.image) </span> |
|Online inference rate limits |Max. RPM |**Non\-4k**:<br><br><br>* Enterprise users: 600<br><br>* Individual users: 180<br><br>   **4k**:<br><br>* Enterprise users: 15<br><br>* Individual users: 15 |* Enterprise users: 600<br><br>* Individual users: 180 |* Enterprise users: 600<br><br>* Individual users: 180 |
||Max. concurrency |**Non\-4k**:<br><br><br>* Enterprise users: 10<br><br>* Individual users: 3<br><br>   **4k**:<br><br>* Enterprise users: 1<br><br>* Individual users: 1 |* Enterprise users: 10<br><br>* Individual users: 3 |* Enterprise users: 10<br><br>* Individual users: 3 |
|Offline inference rate limits |Max. TPD |\- |\- |\- |


<span id="dcb767c3"></span>
# Basic usage

<span id="50e1b4ea"></span>
## Multimodal reference

Input text, reference images, videos (with or without audio tracks) and audios to generate a new video. It can inherit core information including character image, visual style and screen composition from reference images, subject, camera movement, action performance and overall style from reference videos, as well as timbre, music melody and dialogue content from reference audios.

The following are some demos (visit the [model card](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=dreamina-seedance-2-0) to view more samples):


<span aceTableMode="list" aceTableWidth="3,2,2"></span>
|Input: text |Input: image, video, audio |Output |
|---|---|---|
|Use the first\-person POV framing from [Video 1] throughout, and use [Audio 1] as the background music throughout. First\-person POV fruit tea promotional ad, seedance limited\-edition apple fruit tea; opening frame is [Image 1], your hand picks a dew\-covered Aksu red apple, a light, crisp apple tapping sound; 2–4 seconds: fast cuts, your hand drops apple chunks into a shaker, adds ice and tea base, shakes forcefully, ice clinking and shaking sounds sync with upbeat rhythmic beats, background audio: {Fresh\-cut, shaken fresh}; 4–6 seconds: first\-person close\-up of the finished drink, layered fruit tea is poured into a clear cup, your hand gently squeezes milk foam to spread across the top, a pink brand sticker is applied to the cup, the camera moves closer to show the layered textures of the foam and fruit tea; 6–8 seconds: first\-person hand\-held toast shot, you raise the fruit tea from [Image 2] toward the camera (simulating handing it to the viewer), the cup label is clearly visible, background audio {Take a sip of fresh refreshment}, the final frame freezes on Image 2. All background voice audio uses a female voice. |<video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/0ba05cd435f543c5bc65c378d94d094a" controls></video><br><br><br><Attachment link="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/8bbbacecfd7d48dfa7ec6ec74125eb04~tplv-goo7wpa0wc-image.image" name="r2v_tea_audio1.mp3">r2v_tea_audio1.mp3</Attachment><br><br><br><span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/37ef4b6af8944a6d9b54ef1c541c1b0e~tplv-goo7wpa0wc-image.image) </span> <span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/91cb11fe32014cd6ad9354e271638d85~tplv-goo7wpa0wc-image.image) </span> |<video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/74d43d21b6cf40248c8060bc8181c318" controls></video><br> |



<Tabs>
<Tab zoneid="ha1wtw9U4Y" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
import time
# Install SDK:pip install byteplus-python-sdk-v2
from byteplussdkarkruntime import Ark 

client = Ark(
    #The base URL for model invocation
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.environ.get("ARK_API_KEY"),
)

if __name__ == "__main__":
    print("----- create request -----")
    create_result = client.content_generation.tasks.create(
        model="dreamina-seedance-2-0-260128", #Replace with Model ID 
        content=[
            {
                "type": "text",
                "text": "Use the first-person POV framing from Video 1 throughout, and use Audio 1 as the background music throughout. First-person POV fruit tea promotional ad, seedance limited-edition apple fruit tea; opening frame is Image 1, your hand picks a dew-covered Aksu red apple, a light, crisp apple tapping sound; 2–4 seconds: fast cuts, your hand drops apple chunks into a shaker, adds ice and tea base, shakes forcefully, ice clinking and shaking sounds sync with upbeat rhythmic beats, background audio: {Fresh-cut, shaken fresh}; 4–6 seconds: first-person close-up of the finished drink, layered fruit tea is poured into a clear cup, your hand gently squeezes milk foam to spread across the top, a pink brand sticker is applied to the cup, the camera moves closer to show the layered textures of the foam and fruit tea; 6–8 seconds: first-person hand-held toast shot, you raise the fruit tea from Image 2 toward the camera (simulating handing it to the viewer), the cup label is clearly visible, background audio {Take a sip of fresh refreshment}, the final frame freezes on Image 2. All background voice audio uses a female voice.",                
            },
            {
                "type": "image_url",
                "image_url": {
                    "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/r2v_tea_pic1.jpg"
                },
                "role": "reference_image",
            },
            {
                "type": "image_url",
                "image_url": {
                    "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/r2v_tea_pic2.jpg"
                },
                "role": "reference_image",
            },
            {
                "type": "video_url",
                "video_url": {
                    "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_video/r2v_tea_video1.mp4"
                },
                "role": "reference_video",
            },
            {
                "type": "audio_url",
                "audio_url": {
                    "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_audio/r2v_tea_audio1.mp3"
                },
                "role": "reference_audio",
            },
        ],
        generate_audio=True,
        ratio="16:9",
        duration=11,
        watermark=True,
    )
    print(create_result)


    # Polling query section
    print("----- polling task status -----")
    task_id = create_result.id
    while True:
        get_result = client.content_generation.tasks.get(task_id=task_id)
        status = get_result.status
        if status == "succeeded":
            print("----- task succeeded -----")
            print(get_result)
            break
        elif status == "failed":
            print("----- task failed -----")
            print(f"Error: {get_result.error}")
            break
        else:
            print(f"Current status: {status}, Retrying after 30 seconds...")
            time.sleep(30)
```



</Tab>
<Tab zoneid="WVT3m1is0f" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;

import com.byteplus.ark.runtime.model.content.generation.*;
import com.byteplus.ark.runtime.model.content.generation.CreateContentGenerationTaskRequest.Content;
import com.byteplus.ark.runtime.service.ArkService;
import okhttp3.ConnectionPool;
import okhttp3.Dispatcher;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

public class ContentGenerationTaskExample {

    // Client initialization
    static String apiKey = System.getenv("ARK_API_KEY");
    static ConnectionPool connectionPool = new ConnectionPool(5, 1, TimeUnit.SECONDS);
    static Dispatcher dispatcher = new Dispatcher();
    static ArkService service = ArkService.builder()
           .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3") //The base URL for model invocation
           .dispatcher(dispatcher)
           .connectionPool(connectionPool)
           .apiKey(apiKey)
           .build();
           
    public static void main(String[] args) {
        
        // Model ID
        final String modelId = "dreamina-seedance-2-0-260128";
        // Text prompt
        final String prompt = "Use the first-person POV framing from [Video 1] throughout, and use [Audio 1] as the background music throughout. First-person POV fruit tea promotional ad, seedance limited-edition apple fruit tea; " +
                "opening frame is [Image 1], your hand picks a dew-covered Aksu red apple, a light, crisp apple tapping sound;" +
                "2–4 seconds: fast cuts, your hand drops apple chunks into a shaker, adds ice and tea base, shakes forcefully, ice clinking and shaking sounds sync with upbeat rhythmic beats, background audio: {Fresh-cut, shaken fresh}; " +
                "4–6 seconds: first-person close-up of the finished drink, layered fruit tea is poured into a clear cup, your hand gently squeezes milk foam to spread across the top, a pink brand sticker is applied to the cup, the camera moves closer to show the layered textures of the foam and fruit tea;" +
                "6–8 seconds: first-person hand-held toast shot, you raise the fruit tea from [Image 2] toward the camera (simulating handing it to the viewer), the cup label is clearly visible, background audio {Take a sip of fresh refreshment}, the final frame freezes on Image 2." +
                "All background voice audio uses a female voice.";
        
        // Example resource URLs
        final String refImage1 = "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/r2v_tea_pic1.jpg";
        final String refImage2 = "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/r2v_tea_pic2.jpg";
        final String refVideo = "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_video/r2v_tea_video1.mp4";
        final String refAudio = "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_audio/r2v_tea_audio1.mp3";

        // Output video parameters
        final boolean generateAudio = true;
        final String videoRatio = "16:9";      
        final long videoDuration = 11L;          
        final boolean showWatermark = true;

        System.out.println("----- create request -----");
        // Build request content
        List<Content> contents = new ArrayList<>();
        
        // 1. Text prompt
        contents.add(Content.builder()
                .type("text")
                .text(prompt)
                .build());
                
        // 2. Reference image 1
        contents.add(Content.builder()
                .type("image_url")
                .imageUrl(CreateContentGenerationTaskRequest.ImageUrl.builder()
                        .url(refImage1)
                        .build())
                .role("reference_image")
                .build());

        // 3. Reference image 2
        contents.add(Content.builder()
                .type("image_url")
                .imageUrl(CreateContentGenerationTaskRequest.ImageUrl.builder()
                        .url(refImage2)
                        .build())
                .role("reference_image")
                .build());

        // 4. Reference video
        contents.add(Content.builder()
                .type("video_url")
                .videoUrl(CreateContentGenerationTaskRequest.VideoUrl.builder()
                        .url(refVideo)  
                        .build())
                .role("reference_video")
                .build());

        // 5. Reference audio
        contents.add(Content.builder()
                .type("audio_url")
                .audioUrl(CreateContentGenerationTaskRequest.AudioUrl.builder()
                        .url(refAudio)
                        .build())
                .role("reference_audio")
                .build());

        // Create video generation task
        CreateContentGenerationTaskRequest createRequest = CreateContentGenerationTaskRequest.builder()
                .generateAudio(generateAudio)
                .model(modelId)
                .content(contents)
                .ratio(videoRatio)
                .duration(videoDuration)
                .watermark(showWatermark)
                .build();

        CreateContentGenerationTaskResult createResult = service.createContentGenerationTask(createRequest);
        System.out.println("Task Created: " + createResult);

        // Get task details and poll status
        String taskId = createResult.getId();
        pollTaskStatus(taskId);
    }

    /**
     * Poll task status
     *@param taskId Task ID
     */

    private static void pollTaskStatus(String taskId) {
        GetContentGenerationTaskRequest getRequest = GetContentGenerationTaskRequest.builder()
                .taskId(taskId)
                .build();

        System.out.println("----- polling task status -----");
        try {
            while (true) {
                GetContentGenerationTaskResponse getResponse = service.getContentGenerationTask(getRequest);
                String status = getResponse.getStatus();

                if ("succeeded".equalsIgnoreCase(status)) {
                    System.out.println("----- task succeeded -----");
                    System.out.println(getResponse);
                    break;
                } else if ("failed".equalsIgnoreCase(status)) {
                    System.out.println("----- task failed -----");
                    if (getResponse.getError() != null) {
                        System.out.println("Error: " + getResponse.getError().getMessage());
                    }
                    break;
                } else {
                    System.out.printf("Current status: %s, Retrying in 10 seconds...%n", status);
                    TimeUnit.SECONDS.sleep(10);
                }
            }
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            System.err.println("Polling interrupted");
        } catch (Exception e) {
            System.err.println("Error occurred: " + e.getMessage());
        } finally {
            service.shutdownExecutor();
        }
    }
}
```



</Tab>
<Tab zoneid="XR0zHCfrof" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"
    "time"

    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
)

func main() {
    // Initialize Ark client
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        //The base URL for model invocation
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )
    ctx := context.Background()

    // Model ID
    modelID := "dreamina-seedance-2-0-260128"
    // Text prompt
    prompt := "Use the first-person POV framing from [Video 1] throughout, and use [Audio 1] as the background music throughout. First-person POV fruit tea promotional ad, seedance limited-edition apple fruit tea; " +
                "opening frame is [Image 1], your hand picks a dew-covered Aksu red apple, a light, crisp apple tapping sound;" +
                "2–4 seconds: fast cuts, your hand drops apple chunks into a shaker, adds ice and tea base, shakes forcefully, ice clinking and shaking sounds sync with upbeat rhythmic beats, background audio: {Fresh-cut, shaken fresh}; " +
                "4–6 seconds: first-person close-up of the finished drink, layered fruit tea is poured into a clear cup, your hand gently squeezes milk foam to spread across the top, a pink brand sticker is applied to the cup, the camera moves closer to show the layered textures of the foam and fruit tea;" +
                "6–8 seconds: first-person hand-held toast shot, you raise the fruit tea from [Image 2] toward the camera (simulating handing it to the viewer), the cup label is clearly visible, background audio {Take a sip of fresh refreshment}, the final frame freezes on Image 2." +
                "All background voice audio uses a female voice."

    // Example resource URLs
    refImage1 := "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/r2v_tea_pic1.jpg"
    refImage2 := "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/r2v_tea_pic2.jpg"
    refVideo := "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_video/r2v_tea_video1.mp4"
    refAudio := "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_audio/r2v_tea_audio1.mp3"

    // Output video parameters
    generateAudio := true
    videoRatio := "16:9"
    videoDuration := int64(11)
    showWatermark := true

    // 1. Create video generation task
    fmt.Println("----- create request -----")
    createReq := model.CreateContentGenerationTaskRequest{
        Model:         modelID,
        GenerateAudio: byteplus.Bool(generateAudio),
        Ratio:         byteplus.String(videoRatio),
        Duration:      byteplus.Int64(videoDuration),
        Watermark:     byteplus.Bool(showWatermark),
        Content: []*model.CreateContentGenerationContentItem{
            {
                Type: model.ContentGenerationContentItemTypeText,
                Text: byteplus.String(prompt),
            },
            {
                Type: model.ContentGenerationContentItemType("image_url"),
                ImageURL: &model.ImageURL{
                    URL: refImage1,
                },
                Role: byteplus.String("reference_image"),
            },
            {
                Type: model.ContentGenerationContentItemType("image_url"),
                ImageURL: &model.ImageURL{
                    URL: refImage2,
                },
                Role: byteplus.String("reference_image"),
            },
            {
                Type: model.ContentGenerationContentItemType("video_url"),
                VideoURL: &model.VideoUrl{
                    Url: refVideo,
                },
                Role: byteplus.String("reference_video"),
            },
            {
                Type: model.ContentGenerationContentItemType("audio_url"),
                AudioURL: &model.AudioUrl{
                    Url: refAudio,
                },
                Role: byteplus.String("reference_audio"),
            },
        },
    }

    createResp, err := client.CreateContentGenerationTask(ctx, createReq)
    if err != nil {
        fmt.Printf("create content generation error: %v\\n", err)
        return
    }

    taskID := createResp.ID
    fmt.Printf("Task Created with ID: %s\\n", taskID)

    // 2. Poll task status
    pollTaskStatus(ctx, client, taskID)
}

// poll task status
func pollTaskStatus(ctx context.Context, client *arkruntime.Client, taskID string) {
    fmt.Println("----- polling task status -----")
    for {
        getReq := model.GetContentGenerationTaskRequest{ID: taskID}
        getResp, err := client.GetContentGenerationTask(ctx, getReq)
        if err != nil {
            fmt.Printf("get content generation task error: %v\\n", err)
            return
        }

        status := getResp.Status
        if status == "succeeded" {
            fmt.Println("----- task succeeded -----")
            fmt.Printf("Task ID: %s \\n", getResp.ID)
            fmt.Printf("Model: %s \\n", getResp.Model)
            fmt.Printf("Video URL: %s \\n", getResp.Content.VideoURL)
            fmt.Printf("Completion Tokens: %d \\n", getResp.Usage.CompletionTokens)
            fmt.Printf("Created At: %d, Updated At: %d\\n", getResp.CreatedAt, getResp.UpdatedAt)
            return
        } else if status == "failed" {
            fmt.Println("----- task failed -----")
            if getResp.Error != nil {
                fmt.Printf("Error Code: %s, Message: %s\\n", getResp.Error.Code, getResp.Error.Message)
            }
            return
        } else {
            fmt.Printf("Current status: %s, Retrying in 10 seconds... \\n", status)
            time.Sleep(10 * time.Second)
        }
    }
}
```



</Tab>
</Tabs>


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>



* <div data-tips="true" data-tips-type="tip">You can combine the following modal content as needed. Note that "text + audio" and "audio\-only" inputs are not supported.</div>


   * <div data-tips="true" data-tips-type="tip">Text</div>


   * <div data-tips="true" data-tips-type="tip">Images: 0–9 images</div>


   * <div data-tips="true" data-tips-type="tip">Videos: 0–3 videos</div>


   * <div data-tips="true" data-tips-type="tip">Audio: 0–3 audios</div>


* <div data-tips="true" data-tips-type="tip"><strong>Advanced usage</strong>: For multimodal video generation, you can specify reference images as the first/last frame via prompts to indirectly achieve the effect of "first and last frames + multimodal reference". If you need to strictly ensure that the first and last frames are consistent with the specified images, please <strong>always use image\-to\-video (first and last frame)</strong> feature (configure the <code>role</code> parameter to <code>first_frame</code> / <code>last_frame</code>).</div>


* <div data-tips="true" data-tips-type="tip">See <a href="https://docs.byteplus.com/en/docs/ModelArk/2298881#63a97f09">Multimodal input</a> for input requirements for each modal information.</div>



<span id="75a28782"></span>
## Edit video

You can provide the video to be edited, reference images or audio, and use prompts together to complete various video editing tasks, such as replacing the video subject, adding, deleting and modifying objects in the video, redrawing/repairing partial frames, etc.

The following are some demos (visit the [model card](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=dreamina-seedance-2-0) to view more samples):


<span aceTableMode="list" aceTableWidth="3,2,2"></span>
|Input: text |Input: video & image |Output |
|---|---|---|
|Replace the cat in [Video 1] with the lion from [Image 1]. The lion lies on its side across the girl’s legs, gently interacting with her in a warm and tender way. |<video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/b172c1b5adf04d6d96f86d19a06bb00a" controls></video><br><br><br><span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/414aa310038e4e0791412e66b5dc7223~tplv-goo7wpa0wc-image.image) </span> |<video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/b0230aa7a0ba4068a03576b6a251f99f" controls></video><br> |



<Tabs>
<Tab zoneid="VqN4NpBf2N" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
import time
# Install SDK:pip install byteplus-python-sdk-v2
from byteplussdkarkruntime import Ark 

client = Ark(
    #The base URL for model invocation
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.environ.get("ARK_API_KEY"),
)

if __name__ == "__main__":
    print("----- create request -----")
    create_result = client.content_generation.tasks.create(
        model="dreamina-seedance-2-0-260128", #Replace with Model ID 
        content=[
            {
                "type": "text",
                "text": "Replace the cat in [Video1] with the lion from [Image1]. The lion lies on its side across the girl’s legs, gently interacting with her in a warm and tender way.",
            },
            {
                "type": "image_url",
                "image_url": {
                    "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/r2v_edit_pic1.jpg"
                },
                "role": "reference_image",
            },
            {
                "type": "video_url",
                "video_url": {
                    "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_video/r2v_edit_video1.mp4"
                },
                "role": "reference_video",
            },
        ],
        generate_audio=True,
        ratio="16:9",
        duration=5,
        watermark=True,
    )
    print(create_result)


    # Polling query section
    print("----- polling task status -----")
    task_id = create_result.id
    while True:
        get_result = client.content_generation.tasks.get(task_id=task_id)
        status = get_result.status
        if status == "succeeded":
            print("----- task succeeded -----")
            print(get_result)
            break
        elif status == "failed":
            print("----- task failed -----")
            print(f"Error: {get_result.error}")
            break
        else:
            print(f"Current status: {status}, Retrying after 30 seconds...")
            time.sleep(30)
```



</Tab>
<Tab zoneid="sCQnXLlBSy" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;

import com.byteplus.ark.runtime.model.content.generation.*;
import com.byteplus.ark.runtime.model.content.generation.CreateContentGenerationTaskRequest.Content;
import com.byteplus.ark.runtime.service.ArkService;
import okhttp3.ConnectionPool;
import okhttp3.Dispatcher;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

public class ContentGenerationTaskExample {

    // Client initialization
    static String apiKey = System.getenv("ARK_API_KEY");
    static ConnectionPool connectionPool = new ConnectionPool(5, 1, TimeUnit.SECONDS);
    static Dispatcher dispatcher = new Dispatcher();
    static ArkService service = ArkService.builder()
           .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3") //The base URL for model invocation
           .dispatcher(dispatcher)
           .connectionPool(connectionPool)
           .apiKey(apiKey)
           .build();
           
    public static void main(String[] args) {
        
        // Model ID
        final String modelId = "dreamina-seedance-2-0-260128"; 
        // Text prompt
        final String prompt = "Replace the cat in [Video 1] with the lion from [Image 1]. The lion lies on its side across the girl’s legs, gently interacting with her in a warm and tender way.";
        
        // Example resource URLs
        final String refImage1 = "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/r2v_edit_pic1.jpg";
        final String refVideo = "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_video/r2v_edit_video1.mp4";

        // Output video parameters
        final boolean generateAudio = true;
        final String videoRatio = "16:9";      
        final long videoDuration = 5L;          
        final boolean showWatermark = true;

        System.out.println("----- create request -----");
        // Build request content
        List<Content> contents = new ArrayList<>();
        
        // 1. Text prompt
        contents.add(Content.builder()
                .type("text")
                .text(prompt)
                .build());
                
        // 2. Reference image 1
        contents.add(Content.builder()
                .type("image_url")
                .imageUrl(CreateContentGenerationTaskRequest.ImageUrl.builder()
                        .url(refImage1)
                        .build())
                .role("reference_image")
                .build());

        // 3. Reference video
        contents.add(Content.builder()
                .type("video_url")
                .videoUrl(CreateContentGenerationTaskRequest.VideoUrl.builder()
                        .url(refVideo)  
                        .build())
                .role("reference_video")
                .build());

        // Create video generation task
        CreateContentGenerationTaskRequest createRequest = CreateContentGenerationTaskRequest.builder()
                .generateAudio(generateAudio)
                .model(modelId)
                .content(contents)
                .ratio(videoRatio)
                .duration(videoDuration)
                .watermark(showWatermark)
                .build();

        CreateContentGenerationTaskResult createResult = service.createContentGenerationTask(createRequest);
        System.out.println("Task Created: " + createResult);

        // Get task details and poll status
        String taskId = createResult.getId();
        pollTaskStatus(taskId);
    }

    /**
     * Poll task status
     *@param taskId Task ID
     */

    private static void pollTaskStatus(String taskId) {
        GetContentGenerationTaskRequest getRequest = GetContentGenerationTaskRequest.builder()
                .taskId(taskId)
                .build();

        System.out.println("----- polling task status -----");
        try {
            while (true) {
                GetContentGenerationTaskResponse getResponse = service.getContentGenerationTask(getRequest);
                String status = getResponse.getStatus();

                if ("succeeded".equalsIgnoreCase(status)) {
                    System.out.println("----- task succeeded -----");
                    System.out.println(getResponse);
                    break;
                } else if ("failed".equalsIgnoreCase(status)) {
                    System.out.println("----- task failed -----");
                    if (getResponse.getError() != null) {
                        System.out.println("Error: " + getResponse.getError().getMessage());
                    }
                    break;
                } else {
                    System.out.printf("Current status: %s, Retrying in 10 seconds...%n", status);
                    TimeUnit.SECONDS.sleep(10);
                }
            }
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            System.err.println("Polling interrupted");
        } catch (Exception e) {
            System.err.println("Error occurred: " + e.getMessage());
        } finally {
            service.shutdownExecutor();
        }
    }
}
```



</Tab>
<Tab zoneid="bfWWyXWBRA" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"
    "time"

    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
)

func main() {
    // Initialize Ark client
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        //The base URL for model invocation
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )
    ctx := context.Background()

    // Model ID
    modelID := "dreamina-seedance-2-0-260128"
    // Text prompt
    prompt := "Replace the cat in [Video 1] with the lion from [Image 1]. The lion lies on its side across the girl’s legs, gently interacting with her in a warm and tender way."

    // Example resource URLs
    refImage1 := "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/r2v_edit_pic1.jpg"
    refVideo1 := "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_video/r2v_edit_video1.mp4"

    // Output video parameters
    generateAudio := true
    videoRatio := "16:9"
    videoDuration := int64(5)
    showWatermark := true

    // 1. Create video generation task
    fmt.Println("----- create request -----")
    createReq := model.CreateContentGenerationTaskRequest{
        Model:         modelID,
        GenerateAudio: byteplus.Bool(generateAudio),
        Ratio:         byteplus.String(videoRatio),
        Duration:      byteplus.Int64(videoDuration),
        Watermark:     byteplus.Bool(showWatermark),
        Content: []*model.CreateContentGenerationContentItem{
            {
                Type: model.ContentGenerationContentItemTypeText,
                Text: byteplus.String(prompt),
            },
            {
                Type: model.ContentGenerationContentItemType("image_url"),
                ImageURL: &model.ImageURL{
                    URL: refImage1,
                },
                Role: byteplus.String("reference_image"),
            },
            {
                Type: model.ContentGenerationContentItemType("video_url"),
                VideoURL: &model.VideoUrl{
                    Url: refVideo1,
                },
                Role: byteplus.String("reference_video"),
            },
        },
    }

    createResp, err := client.CreateContentGenerationTask(ctx, createReq)
    if err != nil {
        fmt.Printf("create content generation error: %v\\n", err)
        return
    }

    taskID := createResp.ID
    fmt.Printf("Task Created with ID: %s\\n", taskID)

    // 2. Poll task status
    pollTaskStatus(ctx, client, taskID)
}

// poll task status
func pollTaskStatus(ctx context.Context, client *arkruntime.Client, taskID string) {
    fmt.Println("----- polling task status -----")
    for {
        getReq := model.GetContentGenerationTaskRequest{ID: taskID}
        getResp, err := client.GetContentGenerationTask(ctx, getReq)
        if err != nil {
            fmt.Printf("get content generation task error: %v\\n", err)
            return
        }

        status := getResp.Status
        if status == "succeeded" {
            fmt.Println("----- task succeeded -----")
            fmt.Printf("Task ID: %s \\n", getResp.ID)
            fmt.Printf("Model: %s \\n", getResp.Model)
            fmt.Printf("Video URL: %s \\n", getResp.Content.VideoURL)
            fmt.Printf("Completion Tokens: %d \\n", getResp.Usage.CompletionTokens)
            fmt.Printf("Created At: %d, Updated At: %d\\n", getResp.CreatedAt, getResp.UpdatedAt)
            return
        } else if status == "failed" {
            fmt.Println("----- task failed -----")
            if getResp.Error != nil {
                fmt.Printf("Error Code: %s, Message: %s\\n", getResp.Error.Code, getResp.Error.Message)
            }
            return
        } else {
            fmt.Printf("Current status: %s, Retrying in 10 seconds... \\n", status)
            time.Sleep(10 * time.Second)
        }
    }
}
```



</Tab>
</Tabs>


<span id="46d77653"></span>
## Extend video

Based on the original video, you can extend the video forward or backward, or stitch multiple video clips (up to 3 clips) into a coherent video.

The following are some demos (visit the [model card](https://console.byteplus.com/ark/region:ark+ap-southeast-1/model/detail?Id=dreamina-seedance-2-0) to view more samples):


<span aceTableMode="list" aceTableWidth="3,2,2"></span>
|Input: text |Input: video to be extended |Output |
|---|---|---|
|The arched window in [video 1] opens, and the camera moves into the interior of the art museum, transitioning into [video 2]. After that, the camera enters the painting itself, transitioning into [video 3]. |<video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/54519ff7266d4f1caa12b8cc95e2dd1d" controls></video><br><br><br><video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/b15d56c80c884faa8526beb6ca540b98" controls></video><br><br><br><video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/f5d327311e094361b15dca0a37b14ab4" controls></video><br> |<video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/849b3f86f609495ca09d559aa14c79ed" controls></video><br> |



<Tabs>
<Tab zoneid="Pi0wabQwH8" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
import time
# Install SDK:pip install byteplus-python-sdk-v2
from byteplussdkarkruntime import Ark 

client = Ark(
    #The base URL for model invocation
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.environ.get("ARK_API_KEY"),
)

if __name__ == "__main__":
    print("----- create request -----")
    create_result = client.content_generation.tasks.create(
        model="dreamina-seedance-2-0-260128", #Replace with Model ID 
        content=[
            {
                "type": "text",
                "text": "The arched window in [video 1] opens, and the camera moves into the interior of the art museum, transitioning into [video 2]. After that, the camera enters the painting itself, transitioning into [video 3].",
                
            },
            {
                "type": "video_url",
                "video_url": {
                    "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_video/r2v_extend_video1.mp4"
                },
                "role": "reference_video",
            },
            {
                "type": "video_url",
                "video_url": {
                    "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_video/r2v_extend_video2.mp4"
                },
                "role": "reference_video",
            },
            {
                "type": "video_url",
                "video_url": {
                    "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_video/r2v_extend_video3.mp4"
                },
                "role": "reference_video",
            },
        ],
        generate_audio=True,
        ratio="16:9",
        duration=8,
        watermark=True,
    )
    print(create_result)


    # Polling query section
    print("----- polling task status -----")
    task_id = create_result.id
    while True:
        get_result = client.content_generation.tasks.get(task_id=task_id)
        status = get_result.status
        if status == "succeeded":
            print("----- task succeeded -----")
            print(get_result)
            break
        elif status == "failed":
            print("----- task failed -----")
            print(f"Error: {get_result.error}")
            break
        else:
            print(f"Current status: {status}, Retrying after 30 seconds...")
            time.sleep(30)
```



</Tab>
<Tab zoneid="JMExan8oXl" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;

import com.byteplus.ark.runtime.model.content.generation.*;
import com.byteplus.ark.runtime.model.content.generation.CreateContentGenerationTaskRequest.Content;
import com.byteplus.ark.runtime.service.ArkService;
import okhttp3.ConnectionPool;
import okhttp3.Dispatcher;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

public class ContentGenerationTaskExample {

    // Client initialization
    static String apiKey = System.getenv("ARK_API_KEY");
    static ConnectionPool connectionPool = new ConnectionPool(5, 1, TimeUnit.SECONDS);
    static Dispatcher dispatcher = new Dispatcher();
    static ArkService service = ArkService.builder()
           .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3") //The base URL for model invocation
           .dispatcher(dispatcher)
           .connectionPool(connectionPool)
           .apiKey(apiKey)
           .build();
           
    public static void main(String[] args) {
        
        // Model ID
        final String modelId = "dreamina-seedance-2-0-260128";
        // Text prompt
        final String prompt = "The arched window in [video 1] opens, and the camera moves into the interior of the art museum, transitioning into [video 2]. After that, the camera enters the painting itself, transitioning into [video 3].";
        
        // Example resource URLs
        final String refVideo1 = "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_video/r2v_extend_video1.mp4";
        final String refVideo2 = "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_video/r2v_extend_video2.mp4";
        final String refVideo3 = "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_video/r2v_extend_video3.mp4";

        // Output video parameters
        final boolean generateAudio = true;
        final String videoRatio = "16:9";      
        final long videoDuration = 8L;          
        final boolean showWatermark = true;

        System.out.println("----- create request -----");
        // Build request content
        List<Content> contents = new ArrayList<>();
        
        // 1. Text prompt
        contents.add(Content.builder()
                .type("text")
                .text(prompt)
                .build());
                
        // 2. Reference video 1
        contents.add(Content.builder()
                .type("video_url")
                .videoUrl(CreateContentGenerationTaskRequest.VideoUrl.builder()
                        .url(refVideo1)  
                        .build())
                .role("reference_video")
                .build());

        // 3. Reference video 2
        contents.add(Content.builder()
                .type("video_url")
                .videoUrl(CreateContentGenerationTaskRequest.VideoUrl.builder()
                        .url(refVideo2)  
                        .build())
                .role("reference_video")
                .build());

        // 4. Reference video 3
        contents.add(Content.builder()
                .type("video_url")
                .videoUrl(CreateContentGenerationTaskRequest.VideoUrl.builder()
                        .url(refVideo3)  
                        .build())
                .role("reference_video")
                .build());

        // Create video generation task
        CreateContentGenerationTaskRequest createRequest = CreateContentGenerationTaskRequest.builder()
                .generateAudio(generateAudio)
                .model(modelId)
                .content(contents)
                .ratio(videoRatio)
                .duration(videoDuration)
                .watermark(showWatermark)
                .build();

        CreateContentGenerationTaskResult createResult = service.createContentGenerationTask(createRequest);
        System.out.println("Task Created: " + createResult);

        // Get task details and poll status
        String taskId = createResult.getId();
        pollTaskStatus(taskId);
    }

    /**
     * Poll task status
     *@param taskId Task ID
     */

    private static void pollTaskStatus(String taskId) {
        GetContentGenerationTaskRequest getRequest = GetContentGenerationTaskRequest.builder()
                .taskId(taskId)
                .build();

        System.out.println("----- polling task status -----");
        try {
            while (true) {
                GetContentGenerationTaskResponse getResponse = service.getContentGenerationTask(getRequest);
                String status = getResponse.getStatus();

                if ("succeeded".equalsIgnoreCase(status)) {
                    System.out.println("----- task succeeded -----");
                    System.out.println(getResponse);
                    break;
                } else if ("failed".equalsIgnoreCase(status)) {
                    System.out.println("----- task failed -----");
                    if (getResponse.getError() != null) {
                        System.out.println("Error: " + getResponse.getError().getMessage());
                    }
                    break;
                } else {
                    System.out.printf("Current status: %s, Retrying in 10 seconds...%n", status);
                    TimeUnit.SECONDS.sleep(10);
                }
            }
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            System.err.println("Polling interrupted");
        } catch (Exception e) {
            System.err.println("Error occurred: " + e.getMessage());
        } finally {
            service.shutdownExecutor();
        }
    }
}
```



</Tab>
<Tab zoneid="m7VMO6aWSy" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"
    "time"

    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
)

func main() {
    // Initialize Ark client
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        //The base URL for model invocation
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )
    ctx := context.Background()

    // Model ID
    modelID := "dreamina-seedance-2-0-260128"
    // Text prompt
    prompt := "The arched window in [video 1] opens, and the camera moves into the interior of the art museum, transitioning into [video 2]. After that, the camera enters the painting itself, transitioning into [video 3]."

    // Example resource URLs
    refVideo1 := "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_video/r2v_extend_video1.mp4"
    refVideo2 := "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_video/r2v_extend_video2.mp4"
    refVideo3 := "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_video/r2v_extend_video3.mp4"

    // Output video parameters
    generateAudio := true
    videoRatio := "16:9"
    videoDuration := int64(8)
    showWatermark := true

    // 1. Create video generation task
    fmt.Println("----- create request -----")
    createReq := model.CreateContentGenerationTaskRequest{
        Model:         modelID,
        GenerateAudio: byteplus.Bool(generateAudio),
        Ratio:         byteplus.String(videoRatio),
        Duration:      byteplus.Int64(videoDuration),
        Watermark:     byteplus.Bool(showWatermark),
        Content: []*model.CreateContentGenerationContentItem{
            {
                Type: model.ContentGenerationContentItemTypeText,
                Text: byteplus.String(prompt),
            },
            {
                Type: model.ContentGenerationContentItemType("video_url"),
                VideoURL: &model.VideoUrl{
                    Url: refVideo1,
                },
                Role: byteplus.String("reference_video"),
            },
            {
                Type: model.ContentGenerationContentItemType("video_url"),
                VideoURL: &model.VideoUrl{
                    Url: refVideo2,
                },
                Role: byteplus.String("reference_video"),
            },
            {
                Type: model.ContentGenerationContentItemType("video_url"),
                VideoURL: &model.VideoUrl{
                    Url: refVideo3,
                },
                Role: byteplus.String("reference_video"),
            },
        },
    }

    createResp, err := client.CreateContentGenerationTask(ctx, createReq)
    if err != nil {
        fmt.Printf("create content generation error: %v\\n", err)
        return
    }

    taskID := createResp.ID
    fmt.Printf("Task Created with ID: %s\\n", taskID)

    // 2. Poll task status
    pollTaskStatus(ctx, client, taskID)
}

// poll task status
func pollTaskStatus(ctx context.Context, client *arkruntime.Client, taskID string) {
    fmt.Println("----- polling task status -----")
    for {
        getReq := model.GetContentGenerationTaskRequest{ID: taskID}
        getResp, err := client.GetContentGenerationTask(ctx, getReq)
        if err != nil {
            fmt.Printf("get content generation task error: %v\\n", err)
            return
        }

        status := getResp.Status
        if status == "succeeded" {
            fmt.Println("----- task succeeded -----")
            fmt.Printf("Task ID: %s \\n", getResp.ID)
            fmt.Printf("Model: %s \\n", getResp.Model)
            fmt.Printf("Video URL: %s \\n", getResp.Content.VideoURL)
            fmt.Printf("Completion Tokens: %d \\n", getResp.Usage.CompletionTokens)
            fmt.Printf("Created At: %d, Updated At: %d\\n", getResp.CreatedAt, getResp.UpdatedAt)
            return
        } else if status == "failed" {
            fmt.Println("----- task failed -----")
            if getResp.Error != nil {
                fmt.Printf("Error Code: %s, Message: %s\\n", getResp.Error.Code, getResp.Error.Message)
            }
            return
        } else {
            fmt.Printf("Current status: %s, Retrying in 10 seconds... \\n", status)
            time.Sleep(10 * time.Second)
        }
    }
}
```



</Tab>
</Tabs>


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>



* <div data-tips="true" data-tips-type="tip">When you extend a video clip forward or backward, the generated video usually only includes the tail footage of the original video. But you can also flexibly control it via a prompt to make it include the original video content. For example: Extend Video 1 backward, [description of the extended content...], and <strong>then end with Video 1</strong>.</div>


* <div data-tips="true" data-tips-type="tip">When you pass 2 to 3 video clips to fill in the intermediate transition part, the generated video will include both the original video content and the newly generated video content.</div>



<span id="output-4k-videos"></span>
## Output 4k videos

> Supported only by Seedance 2.0


Seedance 2.0 supports 4k video output and uses 10\-bit encoding, preserving rich color layers and smooth gradient transitions. It meets the requirements of professional film production and HDR video content.

<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">Note</div>


<div data-tips="true" data-tips-type="warning">4k videos are output in H.265 (HEVC) encoding format. Some players or browsers may not support direct playback. For details, see <a href="https://docs.byteplus.com/en/docs/ModelArk/2291680#4k_player">4k player compatibility</a>.</div>



<span aceTableMode="list" aceTableWidth="1,1"></span>
|Preview 1 |Preview 2 |
|---|---|
|<video src="https://ark-project.tos-cn-beijing.volces.com/doc_audio/4K%E5%BD%A9%E5%A6%86-%E9%9F%B3%E4%B9%90.mov" controls></video><br> |<video src="https://ark-project.tos-cn-beijing.volces.com/doc_audio/4K%E6%91%A9%E6%89%98-%E9%9F%B3%E4%B9%90.mov" controls></video><br> |
|Note: The preview videos are stitched from multiple shots generated by Seedance 2.0, and are not directly generated by the following sample code. | |



<Tabs>
<Tab zoneid="HWVXEiM986" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
import time
# Install SDK:  pip install byteplus-python-sdk-v2
from byteplussdkarkruntime import Ark 

client = Ark(
    # The base URL for model invocation
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    # Get API Key：https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.environ.get("ARK_API_KEY"),
)

if __name__ == "__main__":
    print("----- create request -----")
    create_result = client.content_generation.tasks.create(
        model="dreamina-seedance-2-0-260128",
        content=[
            {
                "type": "text",
                "text": "Generate a 15-second off-road motorcycle racing commercial-style short film. Use the reference image as the reference for the mid-sequence jump climax. The shot sequence should be: 1) medium tracking shot: the rider approaches the ramp at high speed from a distance along the dirt slope; 2) extreme close-up from a low angle of the rear wheel kicking up sand, with the tire gripping the ground and throwing up a large amount of dirt and gravel; 3) medium-close shot showing the rider controlling the bike, hand force, suspension compression, and mechanical vibration; 4) side hero medium shot of the rider rushing up the slope and jumping into the air, with the image state close to Image 1 and dirt scattering widely in the backlight; 5) stylish airborne close-up details, highlighting the helmet goggles, hand control on the handlebar, suspended tires, or partial side view of the bike body; 6) medium tracking shot of the landing, suspension compressing and rebounding, then continuing to sprint at high speed along the dirt track to finish. Keep the same rider, same bike, and same track throughout. Make the shot sizes and angles clearly distinct, avoid repetition, keep the action continuous, and create a realistic off-road tracking-shot feel with camera shake, speed, flying dirt, and a sunset backlit racing atmosphere.",
            },
            {
                "type": "image_url",
                "image_url": {
                    "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/i2v_4k.png"
                },
                "role": "reference_image",
            },
        ],
        generate_audio=True,
        resolution="4k",
        ratio="adaptive",
        duration=15,
        watermark=True,
    )
    print(create_result)


    # Polling query section
    print("----- polling task status -----")
    task_id = create_result.id
    while True:
        get_result = client.content_generation.tasks.get(task_id=task_id)
        status = get_result.status
        if status == "succeeded":
            print("----- task succeeded -----")
            print(get_result)
            break
        elif status == "failed":
            print("----- task failed -----")
            print(f"Error: {get_result.error}")
            break
        else:
            print(f"Current status: {status}, Retrying after 30 seconds...")
            time.sleep(30)
```



</Tab>
<Tab zoneid="FqXVexRH0l" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;

import com.byteplus.ark.runtime.model.content.generation.*;
import com.byteplus.ark.runtime.model.content.generation.CreateContentGenerationTaskRequest.Content;
import com.byteplus.ark.runtime.service.ArkService;
import okhttp3.ConnectionPool;
import okhttp3.Dispatcher;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

public class ContentGenerationTaskExample {

    // Client initialization
    static String apiKey = System.getenv("ARK_API_KEY");
    static ConnectionPool connectionPool = new ConnectionPool(5, 1, TimeUnit.SECONDS);
    static Dispatcher dispatcher = new Dispatcher();
    static ArkService service = ArkService.builder()
           .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3") // The base URL for model invocation
           .dispatcher(dispatcher)
           .connectionPool(connectionPool)
           .apiKey(apiKey)
           .build();
           
    public static void main(String[] args) {
        
        // Model ID
        final String modelId = "dreamina-seedance-2-0-260128";
        // Text prompt
        final String prompt = "Generate a 15-second off-road motorcycle racing commercial-style short film. Use the reference image as the reference for the mid-sequence jump climax. " +
                "The shot sequence should be: 1) medium tracking shot: the rider approaches the ramp at high speed from a distance along the dirt slope; " +
                "2) extreme close-up from a low angle of the rear wheel kicking up sand, with the tire gripping the ground and throwing up a large amount of dirt and gravel; " +
                "3) medium-close shot showing the rider controlling the bike, hand force, suspension compression, and mechanical vibration; " +
                "4) side hero medium shot of the rider rushing up the slope and jumping into the air, with the image state close to Image 1 and dirt scattering widely in the backlight; " +
                "5) stylish airborne close-up details, highlighting the helmet goggles, hand control on the handlebar, suspended tires, or partial side view of the bike body; " +
                "6) medium tracking shot of the landing, suspension compressing and rebounding, then continuing to sprint at high speed along the dirt track to finish. " +
                "Keep the same rider, same bike, and same track throughout. Make the shot sizes and angles clearly distinct, avoid repetition, keep the action continuous, " +
                "and create a realistic off-road tracking-shot feel with camera shake, speed, flying dirt, and a sunset backlit racing atmosphere.";
        
        // Example resource URLs
        final String refImage = "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/i2v_4k.png";

        // Output video parameters
        final boolean generateAudio = true;
        final String videoResolution = "4k";
        final String videoRatio = "adaptive";
        final long videoDuration = 15L;
        final boolean showWatermark = true;

        System.out.println("----- create request -----");
        // Build request content
        List<Content> contents = new ArrayList<>();
        
        // 1. Text prompt
        contents.add(Content.builder()
                .type("text")
                .text(prompt)
                .build());
                
        // 2. Reference image
        contents.add(Content.builder()
                .type("image_url")
                .imageUrl(CreateContentGenerationTaskRequest.ImageUrl.builder()
                        .url(refImage)
                        .build())
                .role("reference_image")
                .build());

        // Create video generation task
        CreateContentGenerationTaskRequest createRequest = CreateContentGenerationTaskRequest.builder()
                .generateAudio(generateAudio)
                .model(modelId)
                .content(contents)
                .resolution(videoResolution)
                .ratio(videoRatio)
                .duration(videoDuration)
                .watermark(showWatermark)
                .build();

        CreateContentGenerationTaskResult createResult = service.createContentGenerationTask(createRequest);
        System.out.println("Task Created: " + createResult);

        // Get task details and poll status
        String taskId = createResult.getId();
        pollTaskStatus(taskId);
    }

    /**
     * Poll task status
     * @param taskId Task ID
     */

    private static void pollTaskStatus(String taskId) {
        GetContentGenerationTaskRequest getRequest = GetContentGenerationTaskRequest.builder()
                .taskId(taskId)
                .build();

        System.out.println("----- polling task status -----");
        try {
            while (true) {
                GetContentGenerationTaskResponse getResponse = service.getContentGenerationTask(getRequest);
                String status = getResponse.getStatus();

                if ("succeeded".equalsIgnoreCase(status)) {
                    System.out.println("----- task succeeded -----");
                    System.out.println(getResponse);
                    break;
                } else if ("failed".equalsIgnoreCase(status)) {
                    System.out.println("----- task failed -----");
                    if (getResponse.getError() != null) {
                        System.out.println("Error: " + getResponse.getError().getMessage());
                    }
                    break;
                } else {
                    System.out.printf("Current status: %s, Retrying in 10 seconds...%n", status);
                    TimeUnit.SECONDS.sleep(10);
                }
            }
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            System.err.println("Polling interrupted");
        } catch (Exception e) {
            System.err.println("Error occurred: " + e.getMessage());
        } finally {
            service.shutdownExecutor();
        }
    }
}
```



</Tab>
<Tab zoneid="p8uVlPEiTF" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"
    "time"

    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
)

func main() {
    // Initialize Ark client
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        // The base URL for model invocation
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )
    ctx := context.Background()

    // Model ID
    modelID := "dreamina-seedance-2-0-260128"
    // Text prompt
    prompt := "Generate a 15-second off-road motorcycle racing commercial-style short film. Use the reference image as the reference for the mid-sequence jump climax. " +
        "The shot sequence should be: 1) medium tracking shot: the rider approaches the ramp at high speed from a distance along the dirt slope; " +
        "2) extreme close-up from a low angle of the rear wheel kicking up sand, with the tire gripping the ground and throwing up a large amount of dirt and gravel; " +
        "3) medium-close shot showing the rider controlling the bike, hand force, suspension compression, and mechanical vibration; " +
        "4) side hero medium shot of the rider rushing up the slope and jumping into the air, with the image state close to Image 1 and dirt scattering widely in the backlight; " +
        "5) stylish airborne close-up details, highlighting the helmet goggles, hand control on the handlebar, suspended tires, or partial side view of the bike body; " +
        "6) medium tracking shot of the landing, suspension compressing and rebounding, then continuing to sprint at high speed along the dirt track to finish. " +
        "Keep the same rider, same bike, and same track throughout. Make the shot sizes and angles clearly distinct, avoid repetition, keep the action continuous, " +
        "and create a realistic off-road tracking-shot feel with camera shake, speed, flying dirt, and a sunset backlit racing atmosphere."

    // Example resource URLs
    refImage := "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/i2v_4k.png"

    // Output video parameters
    generateAudio := true
    videoResolution := "4k"
    videoRatio := "adaptive"
    videoDuration := int64(15)
    showWatermark := true

    // 1. Create video generation task
    fmt.Println("----- create request -----")
    createReq := model.CreateContentGenerationTaskRequest{
        Model:         modelID,
        GenerateAudio: byteplus.Bool(generateAudio),
        Resolution:    byteplus.String(videoResolution),
        Ratio:         byteplus.String(videoRatio),
        Duration:      byteplus.Int64(videoDuration),
        Watermark:     byteplus.Bool(showWatermark),
        Content: []*model.CreateContentGenerationContentItem{
            {
                Type: model.ContentGenerationContentItemTypeText,
                Text: byteplus.String(prompt),
            },
            {
                Type: model.ContentGenerationContentItemType("image_url"),
                ImageURL: &model.ImageURL{
                    URL: refImage,
                },
                Role: byteplus.String("reference_image"),
            },
        },
    }

    createResp, err := client.CreateContentGenerationTask(ctx, createReq)
    if err != nil {
        fmt.Printf("create content generation error: %v\\n", err)
        return
    }

    taskID := createResp.ID
    fmt.Printf("Task Created with ID: %s\\n", taskID)

    // 2. Poll task status
    pollTaskStatus(ctx, client, taskID)
}

// poll task status
func pollTaskStatus(ctx context.Context, client *arkruntime.Client, taskID string) {
    fmt.Println("----- polling task status -----")
    for {
        getReq := model.GetContentGenerationTaskRequest{ID: taskID}
        getResp, err := client.GetContentGenerationTask(ctx, getReq)
        if err != nil {
            fmt.Printf("get content generation task error: %v\\n", err)
            return
        }

        status := getResp.Status
        if status == "succeeded" {
            fmt.Println("----- task succeeded -----")
            fmt.Printf("Task ID: %s \\n", getResp.ID)
            fmt.Printf("Model: %s \\n", getResp.Model)
            fmt.Printf("Video URL: %s \\n", getResp.Content.VideoURL)
            fmt.Printf("Completion Tokens: %d \\n", getResp.Usage.CompletionTokens)
            fmt.Printf("Created At: %d, Updated At: %d\\n", getResp.CreatedAt, getResp.UpdatedAt)
            return
        } else if status == "failed" {
            fmt.Println("----- task failed -----")
            if getResp.Error != nil {
                fmt.Printf("Error Code: %s, Message: %s\\n", getResp.Error.Code, getResp.Error.Message)
            }
            return
        } else {
            fmt.Printf("Current status: %s, Retrying in 10 seconds... \\n", status)
            time.Sleep(10 * time.Second)
        }
    }
}
```



</Tab>
</Tabs>


<span id="17c64b2e"></span>
## More capabilities

Seedance 2.0 series models also support common basic capabilities such as text\-to\-video, first\-frame image\-to\-video, first\-and\-last\-frame image\-to\-video, and video output specification configuration. For details, see [Video generation tutorial](https://docs.byteplus.com/en/docs/ModelArk/2298881).

<span id="5c67c9a1"></span>
# Create with ease

Seedance 2.0 series models also support common basic capabilities such as text\-to\-video, first\-frame image\-to\-video, first\-and\-last\-frame image\-to\-video, and video output specification configuration. For details, see [Video generation tutorial](https://docs.byteplus.com/en/docs/ModelArk/2298881).


<span aceTableMode="list" aceTableWidth="1,3"></span>
|Solution |Overview |
|---|---|
|[Trusted outputs as input assets](https://docs.byteplus.com/en/docs/ModelArk/2291680#c24c4bc5) |Original face\-containing outputs generated by some models under your account can be used as input assets of Seedance 2.0 series models without being intercepted by input moderation. |
|[Preset digital characters](https://docs.byteplus.com/en/docs/ModelArk/2291680#2bf01416) |ModelArk has a pre\-built digital character library that provides creatives with free, compliant, and diverse portrait assets. It is suitable for scenarios that require realistic but not specific human faces, and pursue zero compliance risk and fast creation. |
|[Authorized real-person assets](https://docs.byteplus.com/en/docs/ModelArk/2291680#86c3831f) |Supports video generation using authorized real portrait assets. |


<span id="c24c4bc5"></span>
## Trusted outputs as input assets

Seedance 2.0 series models do not support direct upload of reference images or videos containing real human faces. To make it easier for creatives to use human faces for derivative works, ModelArk platform trusts face\-containing outputs generated by the following models. You can use **original face\-containing outputs generated by the following models under your account in the last 30 days** as input assets of Seedance 2.0 series models again for derivative creation.


<span aceTableMode="list" aceTableWidth="3,3,2"></span>
|**Scope of trusted outputs** |**Earliest generation time of trusted outputs** |**Trust expires after** |
|---|---|---|
|Face\-containing videos generated by Seedance 2.0 series models |March 11, 2026 |30 days |
|Last frame images of face\-containing videos generated by Seedance 2.0 series models |April 16, 2026 |30 days |
|Face\-containing images generated by [Dola Seedream 5.0 Lite text to image](https://docs.byteplus.com/en/docs/ModelArk/1824121#text-to-image-text-input-single-image-output) |April 16, 2026 |30 days |


<div data-tips="true" data-tips-type="warning" data-tips-is-title="true">Note</div>



* <div data-tips="true" data-tips-type="warning">Only outputs generated by ModelArk are trusted, while outputs from other platforms are not supported.</div>


* <div data-tips="true" data-tips-type="warning">Only outputs generated under the same account are trusted, while cross\-account use is not supported.</div>


* <div data-tips="true" data-tips-type="warning">Only original model outputs are trusted. Modified or expired outputs cannot be used as input assets.</div>


* <div data-tips="true" data-tips-type="warning">Compressing or forwarding files may invalidate trust verification. We recommend directly saving the model’s original output to TOS for use.</div>


* <div data-tips="true" data-tips-type="warning">Even if the input assets are trusted, outputs may still fail if they violate ModelArk security moderation policies. For details, see <a href="https://docs.byteplus.com/en/docs/ModelArk/1299023">Error codes</a>.</div>


* <div data-tips="true" data-tips-type="warning">The trust policy is for use cases involving human faces only. For use cases that do not use human faces, there is no trust issue with model outputs, and you can create or modify as needed.</div>




<span aceTableMode="list" aceTableWidth="1,2"></span>
|**Input: video generated under the same account** |**Output** |
|---|---|
|<video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/764dcd93aaa64589b114a37d6abbb254" controls></video><br><br><br>> Video generated with [Preset digital characters](https://docs.byteplus.com/en/docs/ModelArk/2291680#2bf01416) |<video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/bc43ce4b4fe9478b9c952889d4b98e8e" controls></video><br><br><br>> Input: Change the color of the cream to white.<br><br>> Change the ratio to 16:9. |



1. Generate an initial video, and obtain the video URL. Here we directly use the example from [Preset digital characters](https://docs.byteplus.com/en/docs/ModelArk/2291680#2bf01416).

2. Edit the video generated by Seedance 2.0 again. The original video URL is only valid for 24 hours. In this example, the original video is transferred to BytePlus TOS for use.


<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">The original video URL is only valid for 24 hours. For actual use, it is recommended that you transfer and save the video file in advance. It is recommended to configure the data subscription function provided by BytePlus TOS to automatically transfer your video outputs to your own TOS bucket for long\-term backup or further processing. For details, see <a href="https://docs.byteplus.com/en/docs/tos/Data_subscription">Data subscription</a>.</div>



<Tabs>
<Tab zoneid="xFIVnrRauG" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
import time
# Install SDK:  pip install byteplus-python-sdk-v2
from byteplussdkarkruntime import Ark 

client = Ark(
    # The base URL for model invocation
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.environ.get("ARK_API_KEY"),
)

if __name__ == "__main__":
    print("----- create request -----")
    create_result = client.content_generation.tasks.create(
        model="dreamina-seedance-2-0-260128", # Replace with Model ID 
        content=[
            {
                "type": "text",
                "text": "Change the color of the cream to white."
            },                
            {
                "type": "video_url",
                "video_url": {
                    "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_video/video_by_sd2.mp4"
                },
                "role": "reference_video"
            },
        ],
        generate_audio=True,
        ratio="16:9",
        duration=11,
        watermark=True,
    )
    print(create_result)
    print("----- polling task status -----")
    task_id = create_result.id
    while True:
        get_result = client.content_generation.tasks.get(task_id=task_id)
        status = get_result.status
        if status == "succeeded":
            print("----- task succeeded -----")
            print(get_result)
            break
        elif status == "failed":
            print("----- task failed -----")
            print(f"Error: {get_result.error}")
            break
        else:
            print(f"Current status: {status}, Retrying after 30 seconds...")
            time.sleep(30)
```



</Tab>
<Tab zoneid="ZqB3sPim9g" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;

import com.byteplus.ark.runtime.model.content.generation.*;
import com.byteplus.ark.runtime.model.content.generation.CreateContentGenerationTaskRequest.Content;
import com.byteplus.ark.runtime.service.ArkService;
import okhttp3.ConnectionPool;
import okhttp3.Dispatcher;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

public class ContentGenerationTaskExample {

    // Client initialization
    static String apiKey = System.getenv("ARK_API_KEY");
    static ConnectionPool connectionPool = new ConnectionPool(5, 1, TimeUnit.SECONDS);
    static Dispatcher dispatcher = new Dispatcher();
    static ArkService service = ArkService.builder()
           .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3") // The base URL for model invocation
           .dispatcher(dispatcher)
           .connectionPool(connectionPool)
           .apiKey(apiKey)
           .build();
           
    public static void main(String[] args) {
        
        // Model ID
        final String modelId = "dreamina-seedance-2-0-260128";
        // Text prompt
        final String prompt = "Change the color of the cream to white.";
        
        // Example resource URLs
        final String refVideo = "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_video/video_by_sd2.mp4";

        // Output video parameters
        final boolean generateAudio = true;
        final String videoRatio = "16:9";      
        final long videoDuration = 11L;          
        final boolean showWatermark = true;

        System.out.println("----- create request -----");
        // Build request content
        List<Content> contents = new ArrayList<>();
        
        // 1. Text prompt
        contents.add(Content.builder()
                .type("text")
                .text(prompt)
                .build());
                
        // 2. Reference video
        contents.add(Content.builder()
                .type("video_url")
                .videoUrl(CreateContentGenerationTaskRequest.VideoUrl.builder()
                        .url(refVideo)
                        .build())
                .role("reference_video")
                .build());

        // Create video generation task
        CreateContentGenerationTaskRequest createRequest = CreateContentGenerationTaskRequest.builder()
                .generateAudio(generateAudio)
                .model(modelId)
                .content(contents)
                .ratio(videoRatio)
                .duration(videoDuration)
                .watermark(showWatermark)
                .build();

        CreateContentGenerationTaskResult createResult = service.createContentGenerationTask(createRequest);
        System.out.println("Task Created: " + createResult);

        // Get task details and poll status
        String taskId = createResult.getId();
        pollTaskStatus(taskId);
    }

    /**
     * Poll task status
     * @param taskId Task ID
     */

    private static void pollTaskStatus(String taskId) {
        GetContentGenerationTaskRequest getRequest = GetContentGenerationTaskRequest.builder()
                .taskId(taskId)
                .build();

        System.out.println("----- polling task status -----");
        try {
            while (true) {
                GetContentGenerationTaskResponse getResponse = service.getContentGenerationTask(getRequest);
                String status = getResponse.getStatus();

                if ("succeeded".equalsIgnoreCase(status)) {
                    System.out.println("----- task succeeded -----");
                    System.out.println(getResponse);
                    break;
                } else if ("failed".equalsIgnoreCase(status)) {
                    System.out.println("----- task failed -----");
                    if (getResponse.getError() != null) {
                        System.out.println("Error: " + getResponse.getError().getMessage());
                    }
                    break;
                } else {
                    System.out.printf("Current status: %s, Retrying in 10 seconds...%n", status);
                    TimeUnit.SECONDS.sleep(10);
                }
            }
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            System.err.println("Polling interrupted");
        } catch (Exception e) {
            System.err.println("Error occurred: " + e.getMessage());
        } finally {
            service.shutdownExecutor();
        }
    }
}
```



</Tab>
<Tab zoneid="g0TOBSyNR6" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"
    "time"

    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
)

func main() {
    // Initialize Ark client
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        // The base URL for model invocation
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )
    ctx := context.Background()

    // Model ID
    modelID := "dreamina-seedance-2-0-260128"
    // Text prompt
    prompt := "Change the color of the cream to white."

    // Example resource URLs
    refVideo1 := "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_video/video_by_sd2.mp4"

    // Output video parameters
    generateAudio := true
    videoRatio := "16:9"
    videoDuration := int64(11)
    showWatermark := true

    // 1. Create video generation task
    fmt.Println("----- create request -----")
    createReq := model.CreateContentGenerationTaskRequest{
        Model:         modelID,
        GenerateAudio: byteplus.Bool(generateAudio),
        Ratio:         byteplus.String(videoRatio),
        Duration:      byteplus.Int64(videoDuration),
        Watermark:     byteplus.Bool(showWatermark),
        Content: []*model.CreateContentGenerationContentItem{
            {
                Type: model.ContentGenerationContentItemTypeText,
                Text: byteplus.String(prompt),
            },
            {
                Type: model.ContentGenerationContentItemType("video_url"),
                VideoURL: &model.VideoUrl{
                    Url: refVideo1,
                },
                Role: byteplus.String("reference_video"),
            },
        },
    }

    createResp, err := client.CreateContentGenerationTask(ctx, createReq)
    if err != nil {
        fmt.Printf("create content generation error: %v\\n", err)
        return
    }

    taskID := createResp.ID
    fmt.Printf("Task Created with ID: %s\\n", taskID)

    // 2. Poll task status
    pollTaskStatus(ctx, client, taskID)
}

// poll task status
func pollTaskStatus(ctx context.Context, client *arkruntime.Client, taskID string) {
    fmt.Println("----- polling task status -----")
    for {
        getReq := model.GetContentGenerationTaskRequest{ID: taskID}
        getResp, err := client.GetContentGenerationTask(ctx, getReq)
        if err != nil {
            fmt.Printf("get content generation task error: %v\\n", err)
            return
        }

        status := getResp.Status
        if status == "succeeded" {
            fmt.Println("----- task succeeded -----")
            fmt.Printf("Task ID: %s \\n", getResp.ID)
            fmt.Printf("Model: %s \\n", getResp.Model)
            fmt.Printf("Video URL: %s \\n", getResp.Content.VideoURL)
            fmt.Printf("Completion Tokens: %d \\n", getResp.Usage.CompletionTokens)
            fmt.Printf("Created At: %d, Updated At: %d\\n", getResp.CreatedAt, getResp.UpdatedAt)
            return
        } else if status == "failed" {
            fmt.Println("----- task failed -----")
            if getResp.Error != nil {
                fmt.Printf("Error Code: %s, Message: %s\\n", getResp.Error.Code, getResp.Error.Message)
            }
            return
        } else {
            fmt.Printf("Current status: %s, Retrying in 10 seconds... \\n", status)
            time.Sleep(10 * time.Second)
        }
    }
}
```



</Tab>
</Tabs>


<span id="2bf01416"></span>
## Preset digital characters

For realistic style videos, you can control the character appearance through pre\-built avatars in the digital character library. Each asset has a unique asset ID. You can generate a video by passing `asset://<asset ID>` in the **content._url.url**parameter.

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">To activate the digital character library or browse and search for digital characters, see <a href="https://docs.byteplus.com/en/docs/ModelArk/2223965">Digital character library</a>.</div>



<span aceTableMode="list" aceTableWidth="3,2,2"></span>
|Input: text |Input: digital character, image |Output |
|---|---|---|
|Vertical HD close\-up video of a beauty blogger (Image 1). She has bold, glamorous makeup with no facial shine or glare and a sweet smile. She holds a face cream jar (Image 2), presents it directly to the camera. The background is fresh and minimalist. Energetic and sweet style. Character speaks in real\-time: 'I found my holy grail face cream! It has a cloud\-like creamy texture that absorbs instantly. Perfect for post\-all\-nighter rescue, deep hydration and moisturization—my skin glows naturally even without makeup!'<br><br><div data-tips="true" data-tips-type="warning" data-tips-is-title="true">warning</div><br><br><br><div data-tips="true" data-tips-type="warning">The Asset ID is only used to pass assets to the model. Prompts must reference assets in the format <strong>asset type + number</strong>, where the number is the sorting order of the asset among assets of the same type in the request body.</div><br><br><br><div data-tips="true" data-tips-type="warning">Correct usage: The beauty influencer in <strong>Image 1</strong></div><br><br><br><div data-tips="true" data-tips-type="warning">Incorrect usage: asset\-2026\*\*\*\* is a beauty influencer</div><br> |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/cf2763b55b124d53b9387f697b9c3ba2~tplv-goo7wpa0wc-image.image) </span><br><br>> Digital character<br><br><br><span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/791b783fc6cd4394b13f41b66b5ff461~tplv-goo7wpa0wc-image.image) </span><br><br>> Product image |<video src="https://p9-arcosite.byteimg.com/obj/tos-cn-i-goo7wpa0wc/764dcd93aaa64589b114a37d6abbb254" controls></video><br> |



<Tabs>
<Tab zoneid="Kjzh2d5Odv" title="Python">
<TabTitle>Python</TabTitle>

```Python
import os
import time
# Install SDK:pip install byteplus-python-sdk-v2
from byteplussdkarkruntime import Ark 

client = Ark(
    #The base URL for model invocation
    base_url='https://ark.ap-southeast.bytepluses.com/api/v3',
    # Get API Key: https://console.byteplus.com/ark/region:ark+ap-southeast-1/apikey
    api_key=os.environ.get("ARK_API_KEY"),
)

if __name__ == "__main__":
    print("----- create request -----")
    create_result = client.content_generation.tasks.create(
        model="dreamina-seedance-2-0-260128", #Replace with Model ID 
        content=[
            {
                "type": "text",
                "text": "Vertical HD close-up video of a beauty blogger (Image 1). She has bold, glamorous makeup with no facial shine or glare and a sweet smile. She holds a face cream jar (Image 2), presents it directly to the camera. The background is fresh and minimalist. Energetic and sweet style. Character speaks in real-time: 'I found my holy grail face cream! It has a cloud-like creamy texture that absorbs instantly. Perfect for post-all-nighter rescue, deep hydration and moisturization—my skin glows naturally even without makeup!'"
            },        
            {
                "type": "image_url",
                "image_url": {
                    "url": "asset://asset-20260410114236-8cdfz"
                },
                "role": "reference_image"
            },
            {
                "type": "image_url",
                "image_url": {
                    "url": "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/r2v_edit_pic1.jpg"
                },
                "role": "reference_image"
            },
        ],
        generate_audio=True,
        ratio="adaptive",
        duration=11,
        watermark=True,
    )
    print(create_result)

    print("----- polling task status -----")
    task_id = create_result.id
    while True:
        get_result = client.content_generation.tasks.get(task_id=task_id)
        status = get_result.status
        if status == "succeeded":
            print("----- task succeeded -----")
            print(get_result)
            break
        elif status == "failed":
            print("----- task failed -----")
            print(f"Error: {get_result.error}")
            break
        else:
            print(f"Current status: {status}, Retrying after 30 seconds...")
            time.sleep(30)
```



</Tab>
<Tab zoneid="nIwmj1OOAw" title="Java">
<TabTitle>Java</TabTitle>

```Java
package com.ark.sample;

import com.byteplus.ark.runtime.model.content.generation.*;
import com.byteplus.ark.runtime.model.content.generation.CreateContentGenerationTaskRequest.Content;
import com.byteplus.ark.runtime.service.ArkService;
import okhttp3.ConnectionPool;
import okhttp3.Dispatcher;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

public class ContentGenerationTaskExample {

    // Client initialization
    static String apiKey = System.getenv("ARK_API_KEY");
    static ConnectionPool connectionPool = new ConnectionPool(5, 1, TimeUnit.SECONDS);
    static Dispatcher dispatcher = new Dispatcher();
    static ArkService service = ArkService.builder()
           .baseUrl("https://ark.ap-southeast.bytepluses.com/api/v3") //The base URL for model invocation
           .dispatcher(dispatcher)
           .connectionPool(connectionPool)
           .apiKey(apiKey)
           .build();
           
    public static void main(String[] args) {
        
        // Model ID
        final String modelId = "dreamina-seedance-2-0-260128";
        // Text prompt
        final String prompt = "Vertical HD close-up video of a beauty blogger (Image 1). She has bold, glamorous makeup with no facial shine or glare and a sweet smile. She holds a face cream jar (Image 2), presents it directly to the camera. The background is fresh and minimalist. Energetic and sweet style. Character speaks in real-time: 'I found my holy grail face cream! It has a cloud-like creamy texture that absorbs instantly. Perfect for post-all-nighter rescue, deep hydration and moisturization—my skin glows naturally even without makeup!'";
        
        // Example resource URLs
        final String refImage1 = "asset://asset-20260410114236-8cdfz";
        final String refImage2 = "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/r2v_edit_pic1.jpg";

        // Output video parameters
        final boolean generateAudio = true;
        final String videoRatio = "adaptive";      
        final long videoDuration = 11L;          
        final boolean showWatermark = true;

        System.out.println("----- create request -----");
        // Build request content
        List<Content> contents = new ArrayList<>();
        
        // 1. Text prompt
        contents.add(Content.builder()
                .type("text")
                .text(prompt)
                .build());
                
        // 2. Reference image 1
        contents.add(Content.builder()
                .type("image_url")
                .imageUrl(CreateContentGenerationTaskRequest.ImageUrl.builder()
                        .url(refImage1)
                        .build())
                .role("reference_image")
                .build());

        // 3. Reference image 2
        contents.add(Content.builder()
                .type("image_url")
                .imageUrl(CreateContentGenerationTaskRequest.ImageUrl.builder()
                        .url(refImage2)
                        .build())
                .role("reference_image")
                .build());

        // Create video generation task
        CreateContentGenerationTaskRequest createRequest = CreateContentGenerationTaskRequest.builder()
                .generateAudio(generateAudio)
                .model(modelId)
                .content(contents)
                .ratio(videoRatio)
                .duration(videoDuration)
                .watermark(showWatermark)
                .build();

        CreateContentGenerationTaskResult createResult = service.createContentGenerationTask(createRequest);
        System.out.println("Task Created: " + createResult);

        // Get task details and poll status
        String taskId = createResult.getId();
        pollTaskStatus(taskId);
    }

    /**
     * Poll task status
     *@param taskId Task ID
     */

    private static void pollTaskStatus(String taskId) {
        GetContentGenerationTaskRequest getRequest = GetContentGenerationTaskRequest.builder()
                .taskId(taskId)
                .build();

        System.out.println("----- polling task status -----");
        try {
            while (true) {
                GetContentGenerationTaskResponse getResponse = service.getContentGenerationTask(getRequest);
                String status = getResponse.getStatus();

                if ("succeeded".equalsIgnoreCase(status)) {
                    System.out.println("----- task succeeded -----");
                    System.out.println(getResponse);
                    break;
                } else if ("failed".equalsIgnoreCase(status)) {
                    System.out.println("----- task failed -----");
                    if (getResponse.getError() != null) {
                        System.out.println("Error: " + getResponse.getError().getMessage());
                    }
                    break;
                } else {
                    System.out.printf("Current status: %s, Retrying in 10 seconds...%n", status);
                    TimeUnit.SECONDS.sleep(10);
                }
            }
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            System.err.println("Polling interrupted");
        } catch (Exception e) {
            System.err.println("Error occurred: " + e.getMessage());
        } finally {
            service.shutdownExecutor();
        }
    }
}
```



</Tab>
<Tab zoneid="MZ0FDTbJdd" title="Go">
<TabTitle>Go</TabTitle>

```Go
package main

import (
    "context"
    "fmt"
    "os"
    "time"

    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/service/arkruntime/model"
    "github.com/byteplus-sdk/byteplus-go-sdk-v2/byteplus"
)

func main() {
    // Initialize Ark client
    client := arkruntime.NewClientWithApiKey(
        os.Getenv("ARK_API_KEY"),
        //The base URL for model invocation
        arkruntime.WithBaseUrl("https://ark.ap-southeast.bytepluses.com/api/v3"),
    )
    ctx := context.Background()

    // Model ID
    modelID := "dreamina-seedance-2-0-260128"
    // Text prompt
    prompt := "Vertical HD close-up video of a beauty blogger (Image 1). She has bold, glamorous makeup with no facial shine or glare and a sweet smile. She holds a face cream jar (Image 2), presents it directly to the camera. The background is fresh and minimalist. Energetic and sweet style. Character speaks in real-time: 'I found my holy grail face cream! It has a cloud-like creamy texture that absorbs instantly. Perfect for post-all-nighter rescue, deep hydration and moisturization—my skin glows naturally even without makeup!'"

    // Example resource URLs
    refImage1 := "asset://asset-20260410114236-8cdfz"
    refImage2 := "https://ark-doc.tos-ap-southeast-1.bytepluses.com/doc_image/r2v_edit_pic1.jpg"

    // Output video parameters
    generateAudio := true
    videoRatio := "adaptive"
    videoDuration := int64(11)
    showWatermark := true

    // 1. Create video generation task
    fmt.Println("----- create request -----")
    createReq := model.CreateContentGenerationTaskRequest{
        Model:         modelID,
        GenerateAudio: byteplus.Bool(generateAudio),
        Ratio:         byteplus.String(videoRatio),
        Duration:      byteplus.Int64(videoDuration),
        Watermark:     byteplus.Bool(showWatermark),
        Content: []*model.CreateContentGenerationContentItem{
            {
                Type: model.ContentGenerationContentItemTypeText,
                Text: byteplus.String(prompt),
            },
            {
                Type: model.ContentGenerationContentItemType("image_url"),
                ImageURL: &model.ImageURL{
                    URL: refImage1,
                },
                Role: byteplus.String("reference_image"),
            },
            {
                Type: model.ContentGenerationContentItemType("image_url"),
                ImageURL: &model.ImageURL{
                    URL: refImage2,
                },
                Role: byteplus.String("reference_image"),
            },
        },
    }

    createResp, err := client.CreateContentGenerationTask(ctx, createReq)
    if err != nil {
        fmt.Printf("create content generation error: %v\\n", err)
        return
    }

    taskID := createResp.ID
    fmt.Printf("Task Created with ID: %s\\n", taskID)

    // 2. Poll task status
    pollTaskStatus(ctx, client, taskID)
}

// poll task status
func pollTaskStatus(ctx context.Context, client *arkruntime.Client, taskID string) {
    fmt.Println("----- polling task status -----")
    for {
        getReq := model.GetContentGenerationTaskRequest{ID: taskID}
        getResp, err := client.GetContentGenerationTask(ctx, getReq)
        if err != nil {
            fmt.Printf("get content generation task error: %v\\n", err)
            return
        }

        status := getResp.Status
        if status == "succeeded" {
            fmt.Println("----- task succeeded -----")
            fmt.Printf("Task ID: %s \\n", getResp.ID)
            fmt.Printf("Model: %s \\n", getResp.Model)
            fmt.Printf("Video URL: %s \\n", getResp.Content.VideoURL)
            fmt.Printf("Completion Tokens: %d \\n", getResp.Usage.CompletionTokens)
            fmt.Printf("Created At: %d, Updated At: %d\\n", getResp.CreatedAt, getResp.UpdatedAt)
            return
        } else if status == "failed" {
            fmt.Println("----- task failed -----")
            if getResp.Error != nil {
                fmt.Printf("Error Code: %s, Message: %s\\n", getResp.Error.Code, getResp.Error.Message)
            }
            return
        } else {
            fmt.Printf("Current status: %s, Retrying in 10 seconds... \\n", status)
            time.Sleep(10 * time.Second)
        }
    }
}
```



</Tab>
</Tabs>


<span id="86c3831f"></span>
## Authorized real\-person assets

After passing real\-person verification and obtaining personal authorization, you can upload relevant assets of the real person (such as images, videos, and audio of the real person) to ModelArk. After the asset is successfully registered, each asset will get an independent Asset ID. You can pass `asset://<asset ID>` in the **content._url.url**parameter to use this asset to generate videos. For the real\-person verification and asset registration process, see [Add real-human assets to asset library](https://docs.byteplus.com/en/docs/ModelArk/2315856).

```JSON
...
"content": [
         {
            "type": "text",
            "text": "<your prompt>"
        },
        {
            "type": "image_url",
            "image_url": {
                "url": "asset://<asset ID>"
            },
            "role": "reference_image"
        },
        {
            "type": "video_url",
            "video_url": {
                "url": "asset://<asset ID>"
            },
            "role": "reference_video"
        },
        {
            "type": "audio_url",
            "audio_url": {
                "url": "asset://<asset ID>"
            },
            "role": "reference_audio"
        }
    ]
...
```


<span id="7f69bcbf"></span>
# Prompt engineering techniques

Prompts must reference assets in the format **asset type + number**, where the number is the sorting order of the asset among assets of the same type in the request body. For example, "Image n" refers to the nth reference image with `type="image_url"` in the `content` array (counting starts from 1 in array order). **Note that referencing assets by Asset ID is not supported.** 

The following section describes typical prompt formulas for multimodal reference, video editing, and video extension. For more details, see [Dreamina Seedance 2.0 series prompt guide](https://docs.byteplus.com/en/docs/ModelArk/2222480).

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">ModelArk provides the <strong>Seedance 2.0 prompt optimization skill</strong> to help you tune your prompts.</div>



* <div data-tips="true" data-tips-type="tip">How to install: You can configure the skill file in Code Agent / AI Agent to use it. Take OpenClaw as an example: download the SKILL.md file, copy the full content to the dialog input box, send "Please install this skill", and wait for the tool to complete the installation automatically.</div>


* <div data-tips="true" data-tips-type="tip">How to use: Enter <code>/sd2-pe + your prompt content</code> in the AI dialog box to start debugging prompts.</div>


   <div data-tips="true" data-tips-type="tip">   <Attachment link="https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/1a98a5a8685547568ed9ef257ceabe85~tplv-goo7wpa0wc-image.image" name="SKILL.md">SKILL.md</Attachment>
      </div>
   


<span id="b34e43cc"></span>
## **Multimodal reference**


* Image reference: Reference / extract / combine + "subject / referenced element description" from "Image n" to generate "plot description", keeping the characteristics of "subject / referenced element description" consistent.

* Video reference: Reference "action description / camera movement description / special effect description" from "Video n" to generate "plot description", keeping the action details / camera movement / special effects consistent.

* Audio reference:

   * Voice timbre reference: "Character" says: "lines", voice timbre references "Audio n".

   * Audio content reference: Ideal appearance timing + "Audio n".


<span id="bd0f005e"></span>
## **Edit video**


* Add elements: Clearly describe "element characteristics" + "appearance timing" + "appearance position".

* Delete elements: Specify the elements to be deleted, and emphasize the elements that remain unchanged in the prompt for better result.

* Modify elements: Simply clearly describe the elements to be replaced.


<span id="d7a8f9f2"></span>
## **Extend video**


* Extend video: Extend "Video n" forward/backward + "description of the video to be extended".

* Track completion: "Video 1" + "transition description" + connect to "Video 2" + "transition description" + connect to "Video 3".


<span id="66cb028f"></span>
# Limitations

See [Limitations](https://docs.byteplus.com/en/docs/ModelArk/2298881#66cb028f).

<span id="d21b3c92"></span>
# FAQs

<span id="4k_player"></span>
## 4k player compatibility

The following compatibility test results cover playback of 4K H.265/HEVC 10\-bit videos generated by Seedance 2.0 in browsers and media players on different platforms. Actual performance may vary depending on device configuration.

**Recommended options:** 


* **macOS**: Recommended browsers are Safari and Chrome; recommended media players are VLC, mpv, and QuickTime Player

* **Windows**: Recommended browsers are Edge and Chrome; recommended media players are VLC and mpv


<span id="windows"></span>
### Windows


<Tabs>
<Tab zoneid="w3XpTVoaEC" title="Browser">
<TabTitle>Browser</TabTitle>


|Browser |Support |
|---|---|
|Chrome |Conditional |
|Edge |Conditional |
|Firefox |Conditional |
|Opera |Conditional |



</Tab>
<Tab zoneid="QGYQXeB7zj" title="Player">
<TabTitle>Player</TabTitle>


|Player |Support |
|---|---|
|VLC |Supported |
|Movies & TV |Conditional |
|PotPlayer |Conditional |
|MPC\-HC / MPC\-BE |Conditional |
|mpv |Supported |
|KMPlayer |Supported |



</Tab>
</Tabs>


> **Conditional support**: Requires relatively strong hardware decoding capability. Playback is known to work on Intel i7 + NVIDIA RTX 4070 + Windows 11 or higher configurations. For other configurations, verify by actual testing.


<span id="macos"></span>
### macOS


<Tabs>
<Tab zoneid="DACnnst5hD" title="Browser">
<TabTitle>Browser</TabTitle>


|Browser |Support |
|---|---|
|Safari |Supported |
|Chrome |Conditional |
|Edge |Conditional |
|Firefox |Conditional |
|Opera |Conditional |



</Tab>
<Tab zoneid="daYpu6byDI" title="Player">
<TabTitle>Player</TabTitle>


|Player |Support |
|---|---|
|VLC |Supported |
|QuickTime Player |Supported |
|IINA |Supported |
|mpv |Supported |
|Infuse |Supported |
|Kodi |Conditional |



</Tab>
</Tabs>


> **Conditional support**: Requires relatively strong hardware decoding capability. Playback is known to work on Apple M2 and higher devices. For M1 and lower devices, verify by actual testing.


<span id="1df655fb"></span>
## Video frames contain abrupt jumps

**Typical Symptoms**

In **first\-frame image\-to\-video** and **first\-and\-last\-frame image\-to\-video** scenarios, some frames in the generated video exhibit abrupt changes such as image stretching and compression.

**Root Cause**

The resolution width and height of the input image and output video are inconsistent, causing frame\-to\-frame jumps in the video image.

**Solution**


1. Crop the input image: Refer to the table of supported width and height pixel values for the Seedance 2.0 series models (see the **ratio** field in [Create Video Generation Task API](https://docs.byteplus.com/en/docs/ModelArk/1520757)), and crop the input image to the target width and height pixel values.

2. Set the **ratio** field to `adaptive`.

3. Use the Seedance 2.0 series model to initiate the first\-frame/first\-and\-last\-frame image\-to\-video task again.




