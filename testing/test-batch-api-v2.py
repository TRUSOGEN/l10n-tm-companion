#!/usr/bin/env python3
"""通过插件正式路径验证 Starling PPE 批量 TM Match 接口。

本脚本不自行拼接鉴权 Header，也不读取、复制或输出 AK/SK、Cookie、
agw-auth 签名。它加载 Native Host 的 `search_tm_batch()`，由同目录的
`starling-batch-client.js` 复用已安装 Starling CLI 的官方 Core 完成签名。

默认查询三个已经验证过的英文样本。传入超过十条文案时，Bridge 会按当前
已确认上限 10 自动分块。脚本输出仅包含业务结果摘要，便于人工核对。
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any


DEFAULT_PROJECT_ID = 385
DEFAULT_TEXTS = ["Done", "Settings", "Cancel"]


def parse_args() -> argparse.Namespace:
    """解析可复现实测所需的非敏感参数。"""
    parser = argparse.ArgumentParser(description="验证 Starling PPE 批量 TM Match")
    parser.add_argument("--project-id", type=int, default=DEFAULT_PROJECT_ID)
    parser.add_argument("--source-lang", default="en")
    parser.add_argument("--target-lang", default="zh")
    parser.add_argument("--limit", type=int, default=3)
    parser.add_argument(
        "--text",
        action="append",
        dest="texts",
        help="待查询文案，可重复传入；不传时使用已验证样本",
    )
    return parser.parse_args()


def load_bridge() -> Any:
    """按路径加载插件 Native Host 的正式批量查询实现。"""
    project_root = Path(__file__).resolve().parents[1]
    bridge_path = project_root / "native-host" / "starling-bridge.py"
    spec = importlib.util.spec_from_file_location("starling_bridge", bridge_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载 Bridge：{bridge_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def summarize(response: dict[str, Any]) -> dict[str, Any]:
    """提取用于人工验收的最小业务字段。"""
    results = response.get("results")
    if not isinstance(results, list):
        raise RuntimeError("Bridge 返回结果缺少 results 数组")
    return {
        "result_count": len(results),
        "matches": [
            {
                "source_text": item.get("source_text"),
                "tm_match": item.get("tm_match"),
                "tm_source": item.get("tm_source"),
                "similarity": item.get("similarity"),
                "candidate_count": item.get("candidate_count"),
                "method": item.get("method"),
                "method_version": item.get("method_version"),
                "error": item.get("_err"),
            }
            for item in results
        ],
    }


def main() -> int:
    """执行只读 PPE 查询，并以退出码表达验证结果。"""
    args = parse_args()
    texts = args.texts or DEFAULT_TEXTS
    if not texts:
        raise ValueError("至少需要一条待查询文案")
    bridge = load_bridge()
    response = bridge.search_tm_batch(
        {
            "texts": texts,
            "project_ids": [args.project_id],
            "source_lang": args.source_lang,
            "target_lang": args.target_lang,
            "limit": args.limit,
            "least_score": 0,
            "use_ppe": True,
        }
    )
    print(json.dumps(summarize(response), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"批量 TM 测试失败：{exc}", file=sys.stderr)
        raise SystemExit(1)
