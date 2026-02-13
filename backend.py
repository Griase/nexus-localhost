import os
import glob
import argparse
import json
import time
import asyncio
import requests
import uvicorn
from typing import List, Optional, Dict, Any
from fastapi import FastAPI, HTTPException, Response, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field

# Imports for optional features with cleaner error handling
try:
    from ddgs import DDGS
except ImportError:
    try:
        from duckduckgo_search import DDGS
    except ImportError:
        DDGS = None

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None

try:
    from playwright.async_api import async_playwright
except ImportError:
    async_playwright = None

try:
    from llama_cpp import Llama
except ImportError:
    Llama = None

try:
    from stable_diffusion_cpp import StableDiffusion
except ImportError:
    StableDiffusion = None

# --- Configuration via Arguments (Aligned with user example) ---
parser = argparse.ArgumentParser(description="Nexus Local Bridge / BYOM Manager")
# Using raw string for windows path to avoid escape character issues
parser.add_argument("--dir", type=str, default=r"d:\ggufs", help="Directory containing GGUF files")
parser.add_argument("--img-dir", type=str, default=r"d:\ggufs\img_gens", help="Directory containing Image models (SD)")
parser.add_argument("--port", type=int, default=5484, help="Port to run the server on")
parser.add_argument("--ctx", type=int, default=4096, help="Context size for models")
args, unknown = parser.parse_known_args()

MODEL_DIR = args.dir
IMAGE_DIR = args.img_dir
DEFAULT_PORT = args.port
CONTEXT_SIZE = args.ctx
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SESSIONS_FILE = os.path.join(BASE_DIR, "sessions.json")

# Ensure model directory exists as per user example
if not os.path.exists(MODEL_DIR):
    try:
        os.makedirs(MODEL_DIR)
    except Exception as e:
        print(f"Warning: Could not create {MODEL_DIR}: {e}")

if not os.path.exists(IMAGE_DIR):
    try:
        os.makedirs(IMAGE_DIR)
    except Exception as e:
        print(f"Warning: Could not create {IMAGE_DIR}: {e}")

app = FastAPI(title="Nexus Local Bridge")

# --- Middleware ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_no_cache_header(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# Error handling for validation
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    body = await request.body()
    print(f"[*] Validation Error: {exc}")
    print(f"[*] Request Body: {body.decode()}")
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={"message": "Validation Error", "detail": exc.errors(), "body": body.decode()[:500]}
    )

# --- State ---
class LLMState:
    def __init__(self):
        self.model = None
        self.path = None
        self.sd_model = None
        self.sd_path = None

state = LLMState()

# --- Schemas ---
class ChatMessage(BaseModel):
    role: str
    content: str

# Permissive request model to handle both UI and user's preferred fields
class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    model: Optional[str] = None
    provider_url: Optional[str] = "http://localhost:11434/api/chat"
    mode: Optional[str] = "proxy"
    temperature: Optional[float] = 0.7
    max_tokens: Optional[int] = 2048
    stream: Optional[bool] = False

class LoadModelRequest(BaseModel):
    path: str
    base_dir: Optional[str] = None

class SearchRequest(BaseModel):
    q: str
    max_results: Optional[int] = 8

class SaveFileRequest(BaseModel):
    filename: str
    content: str

class ImageGenRequest(BaseModel):
    prompt: str
    negative_prompt: Optional[str] = "ugly, blurry, low quality"
    steps: Optional[int] = 20
    cfg_scale: Optional[float] = 7.5
    width: Optional[int] = 512
    height: Optional[int] = 512
    seed: Optional[int] = -1
    subfolder: Optional[str] = None
    base_dir: Optional[str] = None

# --- Persistence Helpers ---
def load_sessions_from_disk() -> List[Dict]:
    if not os.path.exists(SESSIONS_FILE): return []
    try:
        with open(SESSIONS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except: return []

def save_sessions_to_disk(sessions: List[Dict]):
    with open(SESSIONS_FILE, "w", encoding="utf-8") as f:
        json.dump(sessions, f, indent=4)

# --- Endpoints ---

@app.get("/api/status")
@app.get("/health")
async def get_status():
    return {
        "status": "ok",
        "current_model": os.path.basename(state.path) if state.path else None,
        "loaded": state.model is not None,
        "image_model": os.path.basename(state.sd_path) if state.sd_path else None,
        "image_loaded": state.sd_model is not None,
        "model_dir": os.path.abspath(MODEL_DIR),
        "image_dir": os.path.abspath(IMAGE_DIR),
        "context_size": CONTEXT_SIZE,
        "timestamp": time.time()
    }

@app.get("/api/models")
@app.get("/v1/models")
async def list_models(path: Optional[str] = None):
    search_path = os.path.normpath(path if path else MODEL_DIR)
    print(f"[*] Scanning for LLM models in: {search_path}")
    
    if not os.path.exists(search_path):
        return {"models": [], "error": f"Path not found: {search_path}"}
        
    try:
        files = glob.glob(os.path.join(search_path, "*.gguf"))
        model_list = [os.path.basename(f) for f in files]
        return {
            "models": sorted(model_list),
            "object": "list",
            "data": [{"id": m, "object": "model", "owned_by": "local"} for m in model_list]
        }
    except Exception as e:
        return {"models": [], "error": str(e)}

@app.get("/api/image-models")
async def list_image_models(path: Optional[str] = None):
    """Lists all files in the image directory to allow flexible model types."""
    search_path = os.path.normpath(path if path else IMAGE_DIR)
    print(f"[*] Scanning for Image models in: {search_path}")
    
    if not os.path.exists(search_path):
        return {"models": [], "error": f"Path not found: {search_path}"}
        
    try:
        files = [
            f for f in os.listdir(search_path) 
            if os.path.isfile(os.path.join(search_path, f)) and not f.startswith('.')
        ]
        return {"models": sorted(files)}
    except Exception as e:
        print(f"[!] Error listing image models: {e}")
        return {"models": [], "error": str(e)}

@app.get("/api/image-subfolders")
async def list_image_subfolders(path: Optional[str] = None):
    search_path = os.path.normpath(path if path else IMAGE_DIR)
    if not os.path.exists(search_path):
        return {"subfolders": []}
    
    try:
        subfolders = [f for f in os.listdir(search_path) if os.path.isdir(os.path.join(search_path, f))]
        return {"subfolders": sorted(subfolders)}
    except Exception as e:
        print(f"[!] Error listing subfolders: {e}")
        return {"subfolders": [], "error": str(e)}

class CreateFolderRequest(BaseModel):
    name: str

@app.post("/api/create-image-subfolder")
async def create_image_subfolder(req: CreateFolderRequest):
    if not req.name or ".." in req.name or "/" in req.name or "\\" in req.name:
        raise HTTPException(status_code=400, detail="Invalid folder name.")
        
    new_path = os.path.normpath(os.path.join(IMAGE_DIR, req.name))
    try:
        os.makedirs(new_path, exist_ok=True)
        return {"status": "success", "folder": req.name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/load")
async def load_model_endpoint(req: LoadModelRequest):
    if Llama is None:
        raise HTTPException(status_code=500, detail="llama-cpp-python not installed.")
    
    base = req.base_dir if req.base_dir else MODEL_DIR
    full_path = os.path.normpath(os.path.join(base, req.path))
    
    if not os.path.exists(full_path):
        if os.path.exists(req.path): full_path = req.path
        else: raise HTTPException(status_code=404, detail=f"Model not found at {full_path}")
        
    try:
        print(f"[*] Loading LLM: {full_path}")
        state.model = Llama(model_path=full_path, n_ctx=CONTEXT_SIZE, n_gpu_layers=-1, verbose=False)
        state.path = full_path
        return {"status": "success", "model": req.path}
    except Exception as e:
        print(f"[!] Load failed: {e}")
        state.model = Llama(model_path=full_path, n_ctx=CONTEXT_SIZE, n_gpu_layers=0, verbose=False)
        state.path = full_path
        return {"status": "success", "model": req.path, "warning": "CPU fallback"}

@app.post("/api/load-image-model")
async def load_image_model_endpoint(req: LoadModelRequest):
    if StableDiffusion is None:
        raise HTTPException(status_code=500, detail="stable-diffusion-cpp-python not installed.")
    
    base = req.base_dir if req.base_dir else IMAGE_DIR
    full_path = os.path.normpath(os.path.join(base, req.path))
    
    if not os.path.exists(full_path):
        if os.path.exists(req.path): full_path = req.path
        else: raise HTTPException(status_code=404, detail=f"Model not found at {full_path}")

    try:
        print(f"[*] Loading Image Model: {full_path}")
        # Assuming standard SD-CPP initialization
        state.sd_model = StableDiffusion(model_path=full_path)
        state.sd_path = full_path
        return {"status": "success", "model": req.path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load image model: {str(e)}")

@app.post("/api/generate-image")
async def generate_image(req: ImageGenRequest):
    if not state.sd_model:
        raise HTTPException(status_code=400, detail="No image model loaded.")
    
    try:
        import base64
        import io
        from PIL import Image
        
        print(f"[*] Generating image: {req.prompt}")
        # stable-diffusion-cpp-python returns a PIL Image or similar depending on version
        # Usually: sd.txt2img(prompt=...)
        images = state.sd_model.txt2img(
            prompt=req.prompt,
            negative_prompt=req.negative_prompt,
            steps=req.steps,
            cfg_scale=req.cfg_scale,
            width=req.width,
            height=req.height,
            seed=req.seed
        )
        
        img = images[0]
        
        saved_path = None
        if req.subfolder:
            # Sanitize subfolder to prevent directory traversal
            clean_subfolder = os.path.basename(req.subfolder) if req.subfolder != "." else ""
            base = req.base_dir if req.base_dir else IMAGE_DIR
            out_path = os.path.normpath(os.path.join(base, clean_subfolder))
            try:
                os.makedirs(out_path, exist_ok=True)
                filename = f"nexus_{int(time.time())}.png"
                full_save_path = os.path.join(out_path, filename)
                img.save(full_save_path)
                saved_path = full_save_path
                print(f"[*] Image saved to: {saved_path}")
            except Exception as e:
                print(f"[!] Failed to save image to disk: {e}")

        buffered = io.BytesIO()
        img.save(buffered, format="PNG")
        img_str = base64.b64encode(buffered.getvalue()).decode()
        
        return {
            "status": "success", 
            "image": f"data:image/png;base64,{img_str}",
            "saved_to": saved_path
        }
    except Exception as e:
        import traceback
        print(f"[!] Image Gen Failed: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/v1/chat/completions")
@app.post("/api/chat")
async def chat_endpoint(req: ChatRequest):
    try:
        print(f"[*] Incoming Chat Request: {len(req.messages)} messages, Mode: {req.mode}")
        # 1. Proxy Mode (Ollama / External)
        if req.mode == "proxy":
            try:
                # Use model_dump for Pydantic V2 compatibility, fallback to dict
                msgs = [m.model_dump() if hasattr(m, 'model_dump') else m.dict() for m in req.messages]
                payload = {
                    "model": req.model or "llama3",
                    "messages": msgs,
                    "stream": req.stream,
                    "options": {
                        "temperature": req.temperature,
                        "num_predict": req.max_tokens
                    }
                }
                print(f"[*] Proxying to: {req.provider_url} with model {req.model}")
                resp = requests.post(req.provider_url, json=payload, timeout=60)
                
                if resp.status_code != 200:
                    print(f"[!] Provider returned error {resp.status_code}: {resp.text}")
                    return JSONResponse(
                        status_code=resp.status_code, 
                        content={"error": "Provider Error", "details": resp.text}
                    )
                return resp.json()
            except requests.exceptions.ConnectionError:
                raise HTTPException(status_code=503, detail=f"Could not connect to provider at {req.provider_url}. Is Ollama running?")
            except Exception as e:
                print(f"[!] Proxy Request Failed: {e}")
                raise HTTPException(status_code=500, detail=f"Proxy Error: {str(e)}")

        # 2. Local Mode
        if not state.model:
            if req.model:
                print(f"[*] Auto-loading requested model: {req.model}")
                await load_model_endpoint(LoadModelRequest(path=req.model))
            else:
                raise HTTPException(status_code=400, detail="No model loaded and no model name provided.")

        if not state.model:
            raise HTTPException(status_code=500, detail="Model initialization failed. Check backend logs.")

        # Prepare messages and filter out any empty roles/content
        formatted_messages = []
        for m in req.messages:
            if m.role and m.content:
                formatted_messages.append({"role": m.role, "content": m.content})
        
        print(f"[*] Chat Request: mode={req.mode}, model={req.model}, messages_len={len(formatted_messages)}")

        if req.stream:
            def generator():
                try:
                    stream = state.model.create_chat_completion(
                        messages=formatted_messages,
                        max_tokens=req.max_tokens,
                        temperature=req.temperature,
                        stream=True
                    )
                    for chunk in stream:
                        yield f"data: {json.dumps(chunk)}\n\n"
                    yield "data: [DONE]\n\n"
                except Exception as e:
                    print(f"[!] Streaming Inference Error: {e}")
                    yield f"data: {json.dumps({'error': str(e)})}\n\n"
            return StreamingResponse(generator(), media_type="text/event-stream")
        else:
            output = state.model.create_chat_completion(
                messages=formatted_messages,
                temperature=req.temperature,
                max_tokens=req.max_tokens,
                stream=False
            )
            return {
                "model": os.path.basename(state.path) if state.path else "local",
                "message": output["choices"][0]["message"],
                "choices": output["choices"],
                "done": True
            }
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f"[!] CRITICAL CHAT ERROR:\n{error_trace}")
        return JSONResponse(
            status_code=500,
            content={"message": "Internal Server Error", "detail": str(e), "traceback": error_trace}
        )

@app.post("/search")
async def search(req: SearchRequest):
    if not DDGS: 
        return {"results": [], "error": "ddgs package not found. Run: pip install ddgs"}
    try:
        # Modern DDGS usage often avoids the context manager to bypass scope warnings
        results = DDGS().text(req.q, max_results=req.max_results or 8)
        return {"results": list(results)}
    except Exception as e:
        print(f"[!] Search Failed: {e}")
        return {"results": [], "error": str(e)}

@app.get("/scrape")
async def scrape(url: str, use_browser: bool = False):
    if not use_browser or not async_playwright:
        try:
            response = requests.get(url, timeout=10)
            soup = BeautifulSoup(response.text, 'html.parser')
            for s in soup(["script", "style"]): s.extract()
            return {"content": soup.get_text()[:10000]}
        except Exception as e:
            return {"content": "", "error": str(e)}
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            await page.goto(url, wait_until="networkidle")
            content = await page.content()
            soup = BeautifulSoup(content, 'html.parser')
            text = soup.get_text()
            await browser.close()
            return {"content": text[:15000]}
    except Exception as e:
        return {"content": "", "error": str(e)}

@app.get("/sessions")
async def get_sessions(): return load_sessions_from_disk()

@app.post("/sessions")
async def save_sessions(sessions: List[Dict]):
    save_sessions_to_disk(sessions)
    return {"status": "saved"}

@app.post("/save-file")
async def save_file(request: SaveFileRequest):
    try:
        output_dir = os.path.join(BASE_DIR, "output")
        os.makedirs(output_dir, exist_ok=True)
        file_path = os.path.join(output_dir, os.path.basename(request.filename))
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(request.content)
        return {"status": "success", "path": file_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/", include_in_schema=False)
async def serve_index():
    if os.path.exists(os.path.join(BASE_DIR, "index.html")):
        return FileResponse(os.path.join(BASE_DIR, "index.html"))
    return {"message": "Nexus Bridge running. Place index.html here."}

app.mount("/", StaticFiles(directory=BASE_DIR, html=True), name="static")

if __name__ == "__main__":
    print(f"Nexus Bridge booting on port {DEFAULT_PORT} with model dir {MODEL_DIR}")
    uvicorn.run(app, host="0.0.0.0", port=DEFAULT_PORT)