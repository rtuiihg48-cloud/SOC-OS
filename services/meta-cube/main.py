import os

import uvicorn


if __name__ == "__main__":
    uvicorn.run(
        "meta_cube.api:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8008")),
        reload=False,
    )