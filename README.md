# File Storage App with Hugging Face Buckets

This app is a simple file upload/download manager with local disk storage and optional Hugging Face Storage Bucket integration.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables:

```bash
export HF_BUCKET="ogama2339d/ogama2339d"        # Use your HF bucket name
export HF_TOKEN="hf_xxxxxxxxxxxxxxxxxxxxx"      # Use your HF token
```

3. Run the server:

```bash
npm start
```

4. Open in browser:

`http://localhost:3000`

## Usage

- Local upload/download/delete uses `/api/upload`, `/api/files`, `/api/download/*`, `/api/delete/*`.
- HF bucket operations use `/api/hf/*` and UI controls in the web page.
- Toggle `Local` / `HF Bucket` before Upload.
- `Show HF Bucket Files` and `Refresh HF Bucket Files` are available.

## Notes

- Ensure `HF_BUCKET` and `HF_TOKEN` are set before starting the server.
- HF bucket path is `buckets/<namespace>/<bucket-name>` in the code.
