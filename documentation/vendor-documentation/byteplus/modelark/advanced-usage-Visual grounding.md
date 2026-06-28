Visual Grounding (hereinafter referred to as Grounding) refers to finding the corresponding target in an image according to the task requirements defined in natural language, and then returning the target's coordinates. It requires the model to have visual understanding and natural language understanding capabilities.

The biggest difference from object detection is that it needs to understand natural language when locating objects because the input is natural language. This is also why it is more flexible to use and more natural to interact with.


|**Input** |**Output preview** |‌ |
|---|---|---|
|<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f9a8b28c25ac4d86979de8f52e73def6~tplv-goo7wpa0wc-image.image) </span><br><br>> Prompt: Draw a bounding box around the head of the wolf cartoon character in the middle and output the coordinates of the bounding box. |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/114267ea04e7424a8dc2e168c55b2ae8~tplv-goo7wpa0wc-image.image) </span><br><br>> Model response:`<bbox>175 98 791 476</bbox>` |‌ |


<span id="90aef7dd"></span>
# Supported models

See [Visual understanding](https://docs.byteplus.com/en/docs/ModelArk/1330310#ff5ef604).

<span id="750b19d5"></span>
# Procedure

Now let's dive into the sample code to understand how Grounding works.

<div data-tips="true" data-tips-type="tip" data-tips-is-title="true">Tip</div>


<div data-tips="true" data-tips-type="tip">If you're new to ModelArk, see <a href="https://docs.byteplus.com/en/docs/ModelArk/1399008">Quick start</a> to get up and running quickly.</div>


<span id="cb799c3b"></span>
## 1. Complete the configuration

First, import necessary libraries, set parameters such as model ID, image path, and prompt, and read the API key from environment variables.

```Python
import os
import base64
import cv2
from volcenginesdkarkruntime import Ark

# Configure parameters
DEFAULT_MODEL = "seed-2-0-lite-260228"  #Replace with Model ID .
IMAGE_PATH = "./ark_demo_img.png"
PROMPT = "Draw a bounding box around the head of the wolf cartoon character in the middle and output the coordinates of the bounding box."
BBOX_TAG_START = "<bbox>"
BBOX_TAG_END = "</bbox>"

# Read API key
api_key = os.getenv("ARK_API_KEY")

# Create Ark client
client = Ark(
    api_key=api_key,
    #The base URL for model invocation
    base_url="https://ark.ap-southeast.bytepluses.com/api/v3", 
)
```


<span id="c6651960"></span>
## 2. Read image and convert to Base64 string

Read the local image file and convert it to Base64 string format for transmission via API.

```Python
with open(IMAGE_PATH, "rb") as f:
    base64_image = base64.b64encode(f.read()).decode('utf-8')
```


<span id="10dc2486"></span>
## 3. Call API to generate bounding box

Send the Base64\-encoded image and text prompt as multimodal input to the Grounding model to get prediction results.

```Python
response = client.chat.completions.create(
    model=DEFAULT_MODEL,
    messages=[{
        "role": "user",
        "content": [{
            "type": "image_url",  # Image input
            "image_url": {"url": f"data:image/png;base64,{base64_image}"}
        }, {
            "type": "text",  # Text prompt
            "text": PROMPT
        }]
    }]
)
bbox_content = response.choices[0].message.content
```


<span id="cbfeb48d"></span>
## 4. Parse the bounding box coordinates returned by the model

Extract the bounding box coordinates from the results returned by the model and verify whether their format meets expectations.

The coordinate format is `<bbox>x_min y_min x_max y_max</bbox>`, where (`x_min`, `y_min`) are the coordinates of the top\-left corner of the box, and (`x_max`, `y_max`) are the coordinates of the bottom\-right corner of the box.

```Python
# Check if the result format is correct
if not (bbox_content.startswith(BBOX_TAG_START) and bbox_content.endswith(BBOX_TAG_END)):
    print("Error: Bounding box format is incorrect, missing tag wrapping")
    exit(1)

# Parse coordinate values
try:
    coords_str = bbox_content[len(BBOX_TAG_START):-len(BBOX_TAG_END)]
    coords = list(map(int, coords_str.split()))
    if len(coords) != 4:  # Verify the number of coordinates (xmin, ymin, xmax, ymax)
        raise ValueError("Incorrect number of coordinates, 4 values are required")
    x_min, y_min, x_max, y_max = coords
except ValueError as e:
    print(f"Coordinate parsing failed: {str(e)}")
    exit(1)
```


<span id="7de20f90"></span>
## 5. Draw the bounding box on the original image and save it

Convert coordinates: `x_min`, `y_min`, `x_max`, `y_max` are **scaled coordinates normalized to 1000\*1000**, with **the value range of [0, 999]** . After dividing the image width and height into 1000 equal parts, the coordinate system is drawn with the top\-left corner of the image as the origin, corresponding to the coordinate position of the point. The principle is shown in the following figure.

<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/e247476bb66b4b4f945b48318c18ee9b~tplv-goo7wpa0wc-image.image) </span>

Scale the bounding box coordinates according to the actual size of the image, and map the relative coordinates output by the model to absolute coordinates. This step requires calculation. For example, the absolute value of the horizontal axis of the top\-left corner coordinate is `x=x_min/1000*w`, where w is the actual width of the image.

```Python
# Read original image
image = cv2.imread(IMAGE_PATH)

# Get image size and scale coordinates
h, w = image.shape[:2]
x_min_real = int(x_min * w / 1000)
y_min_real = int(y_min * h / 1000)
x_max_real = int(x_max * w / 1000)
y_max_real = int(y_max * h / 1000)

# Draw red bounding box
cv2.rectangle(image, (x_min_real, y_min_real), (x_max_real, y_max_real), (0, 0, 255), 3)

# Save result image
output_path = os.path.splitext(IMAGE_PATH)[0] + "_with_bboxes.png"
cv2.imwrite(output_path, image)
print(f"Successfully saved annotated image: {output_path}")
```


<span id="4c0fb035"></span>
## Result preview

Configure and run this sample code to generate a preview of the drawn image at the specified path.

<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/114267ea04e7424a8dc2e168c55b2ae8~tplv-goo7wpa0wc-image.image) </span>

<span id="93a6289f"></span>
# Tips


* It is not recommended to put coordinate results (bounding box coordinates) in JSON.

* It is not recommended to specify the output structure of the bounding box.


<span id="aa6f318c"></span>
# More examples


|Scenario |Prompt keywords |Prompt example |Result example |
|---|---|---|---|
|Detecting objects with specific attributes<br><br>> Need to locate objects with specific attributes that match the natural language description in the image |`<bbox>x1 y1 x2 y2</bbox>` |`Box the fire area in the forest, in the form of<bbox>x1 y1 x2 y2</bbox>` |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/e8140cc3d68240fcaab0a92be13101bd~tplv-goo7wpa0wc-image.image) </span> |
|Detecting multiple objects<br><br>> Need to detect objects of multiple predefined categories at the same time |`[{"category": category, "bbox": "<bbox>x1 y1 x2 y2</bbox>"}, {"category": category, "bbox": "<bbox>x1 y1 x2 y2</bbox>"}]` |Please detect all objects in the image that belong to the categories "plate, photo, kid, cup". For each object, please provide its category and bounding box in the format:`[{"category": category, "bbox": "<bbox>x1 y1 x2 y2</bbox>"}, {"category": category, "bbox": "<bbox>x1 y1 x2 y2</bbox>"}]` |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/f768fcf0037a4baf80b2d4157898d8a2~tplv-goo7wpa0wc-image.image) </span> |
|Locating target objects based on reference image<br><br>> Locate the target objects in another image based on the reference image |`<bbox>x1 y1 x2 y2</bbox>` |Please identify similar targets in the second image based on the main target in the first image, and provide the bounding box for each object in the format:`<bbox>x1 y1 x2 y2</bbox>` |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/8ca3750ecfd540f285703e11f3c9edf9~tplv-goo7wpa0wc-image.image) </span> |
|Counting objects<br><br>> Need to count the number of specific objects |`<point>x y</point>` |Locate all people on the water surface in the scene, output points in the format `<point>x1 y1</point>`, and count how many people there are on the water surface. |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/2392404be5034344b31fc99b9e637dac~tplv-goo7wpa0wc-image.image) </span> |
|Recognizing image text<br><br>> Need to extract the text content and position from the image |`<text>text</text><polygon>x1 y1, x2 y2, x3 y3, x4 y4</polygon>` |Mark the text in the image in the format:`<text>text</text><polygon>x1 y1, x2 y2, x3 y3, x4 y4</polygon>` |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/7ef81d129cb34b5a8e3e1c8cc5d67f7e~tplv-goo7wpa0wc-image.image) </span> |
|Detecting 3D objects<br><br>> Detect 3D objects in the image |`<Detailed parameters of the image camera>`<br><br>`<3dbbox>x_center y_center z_center x_size y_size z_size pitch yaw roll</3dbbox>` |The following are the detailed camera parameters of this image.<br><br>`Camera intrinsic parameters: Focal length f_x=5545.08, f_y=5545.08. The principal point coordinates are near the center of the image, so when the image width is 4284 and height is 5712, c_x=2142.00 and c_y=2856.00. We do not consider distortion parameters here. Therefore, the intrinsic matrix K = [[1460.00, 0, 2142.00], [0, 1460.00, 2856.00], [0, 0, 1]].`<br><br>`Camera coordinate system: X-axis to the right, Y-axis downward, Z-axis forward. The origin is the camera position. We use the camera coordinate system as the world coordinate system, that is, the camera extrinsic matrix is [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]].`<br><br>Please output each 3D box in the following format: `<3dbbox>x_center y_center z_center x_size y_size z_size pitch yaw roll</3dbbox>`<br><br>Note:<br><br>(1) x_center, y_center, z_center: The position of the target center along the XYZ axes in the camera coordinate system, in meters.<br><br>(2) x_size, y_size, z_size: The size of the target along the XYZ axes when the rotation angle is zero, in meters.<br><br>(3) pitch, yaw, roll: Euler angles around the XYZ axes respectively. Each angle value here is normalized to (\-1,1) and needs to be multiplied by 180 to convert to the actual angle. Detect cups in the image and display the results in 3D bounding box format. |<span>![图片](https://p9-arcosite.byteimg.com/tos-cn-i-goo7wpa0wc/b8c5fa94a87c4977874c345630e0179e~tplv-goo7wpa0wc-image.image) </span> |




