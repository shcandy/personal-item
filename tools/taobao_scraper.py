#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
淘宝闪购店铺商品爬虫
====================

通过 Playwright 驱动真实 Chromium 浏览器，完成一次扫码登录后（登录态保存在
本地 user_data 目录，之后无需重复登录），访问指定的淘宝闪购店铺页面，
自动滚动加载全部商品，提取「商品名称 + 价格（含原价）」，导出 CSV / Excel。

设计要点
--------
1. 为什么用浏览器自动化而不是直接请求接口？
   淘宝/饿了么体系的 H5 接口（mtop 等）都带有签名与风控校验，直接构造
   请求门槛高、易失效。用真实浏览器打开页面，由页面自身的 JS 完成签名，
   我们只做「读取页面数据」，稳定且对平台干扰最小。
2. 商品提取策略：
   - 首选：用户通过 --selectors 提供精确 CSS 选择器；
   - 兜底：内置启发式算法——在页面中定位价格元素，向上寻找包含图片的
     商品卡片，再从卡片中分离出名称/现价/原价（原价通过删除线样式识别）。
3. 滚动加载：自动滚动页面或内部滚动容器，并尝试点击「加载更多」类按钮，
   连续多轮无新增商品才停止；跨轮次累计去重，兼容虚拟列表。
4. 调试辅助：--debug-html 保存页面快照；默认开启接口 JSON 抓包，
   结果存放在 debug/api_capture/，便于后续改用接口直连。
5. 浏览器通道：默认使用 Playwright 自带 Chromium（需先执行
   python -m playwright install chromium）；若未安装，会自动回退到系统已安装的
   Chrome / Edge，也可用 --channel 显式指定；需要代理时传 --proxy。

适用场景：个人学习、价格监控、竞品调研。
使用前请阅读 README.md 中的合规提示，遵守目标网站协议与相关法律法规，
控制请求频率，不要高频抓取。

用法示例
--------
    # 抓取单个店铺，导出 CSV + Excel
    python scraper.py --url "https://h5.ele.me/shop/xxxxxxxx"

    # 抓取多个店铺
    python scraper.py --url "店铺链接1" --url "店铺链接2"

    # 从文件读取店铺链接（每行一个，# 开头为注释）
    python scraper.py --url-file urls.txt

    # 自定义选择器 + 保存页面快照（页面结构特殊时使用）
    python scraper.py --url "..." --selectors "{\"item\":\".goods-item\",\"name\":\".title\",\"price\":\".price\"}" --debug-html
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

try:
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover
    sys.stderr.write(
        "[ERROR] 未安装 playwright。\n"
        "        请先执行: pip install -r requirements.txt\n"
        "        然后执行: python -m playwright install chromium\n"
    )
    sys.exit(1)

try:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter
except ImportError:  # pragma: no cover
    Workbook = None

# Windows 控制台中文输出兼容
if sys.platform == "win32":  # pragma: no cover
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

BASE_DIR = Path(__file__).resolve().parent

# 手机 UA（淘宝闪购是 H5 页面，默认模拟手机访问）
MOBILE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
)

# 登录态 Cookie 标记（淘宝系/饿了么系任一出现即视为已登录）
LOGIN_COOKIE_MARKERS = {
    "cookie2", "_tb_token_", "lgc", "tracknick", "unb",
    "USERID", "SID", "eleme_uid",
}

# 「加载更多」类按钮文案（精确匹配叶子节点，避免误点）
LOAD_MORE_TEXTS = ["加载更多", "查看更多", "点击加载", "点击加载更多", "展开更多", "查看全部商品"]

CSV_HEADER = ["序号", "店铺", "商品名称", "价格", "价格(元)", "原价", "原价(元)", "商品链接", "抓取时间"]


# ---------------------------------------------------------------------------
# 页面内执行的 JS（提取商品 / 滚动页面 / 点击加载更多）
# ---------------------------------------------------------------------------

EXTRACT_ITEMS_JS = r"""
(cfg) => {
  const priceRe = /[¥￥]\s*\d+(?:\.\d{1,2})?/;
  const numRe = /^\d+(?:\.\d{1,2})?$/;
  const NOISE = ['已售','月售','销量','好评','配送','起送','评价','赞','收藏','人想买',
                 '回头客','看过','咨询','优惠','券','小时达','分钟','免配送费','满减',
                 '折扣','红包','特价','新客','复购','距离','自提','营业'];
  const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
  const isNoise = (t) => NOISE.some((n) => t.indexOf(n) !== -1);
  const findLink = (card) => {
    if (card.matches && card.matches('a[href]')) return card;
    return card.querySelector('a[href]');
  };
  const isStrike = (el) => {
    let e = el;
    for (let i = 0; i < 3 && e; i++) {
      const cs = getComputedStyle(e);
      const d = (cs.textDecoration || '') + ' ' + (cs.textDecorationLine || '');
      if (d.indexOf('line-through') !== -1) return true;
      e = e.parentElement;
    }
    return false;
  };

  // ---- 模式一：用户提供精确选择器 ----
  if (cfg.itemSelector) {
    const cards = Array.from(document.querySelectorAll(cfg.itemSelector));
    const items = [];
    for (const card of cards) {
      const nameEl = cfg.nameSelector ? card.querySelector(cfg.nameSelector) : null;
      const priceEl = cfg.priceSelector ? card.querySelector(cfg.priceSelector) : null;
      const origEl = cfg.originalPriceSelector ? card.querySelector(cfg.originalPriceSelector) : null;
      const a = findLink(card);
      const name = clean(nameEl ? nameEl.textContent : '');
      const price = clean(priceEl ? priceEl.textContent : '');
      const original = origEl ? clean(origEl.textContent) : '';
      if (!name && !price) continue;
      items.push({
        name: name,
        price: price,
        original_price: original,
        link: a ? a.href : '',
        card_text: clean(card.textContent).slice(0, 300)
      });    }
    return { mode: 'selector', items: items, shop: clean(document.title) };
  }

  // ---- 模式二：启发式提取 ----
  // 1) 找出所有「像价格」的叶子元素
  const priceEls = [];
  const all = document.querySelectorAll('*');
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if (el.children.length > 0) continue;
    const t = clean(el.textContent);
    if (!t || t.length > 20) continue;
    if (priceRe.test(t) || numRe.test(t)) priceEls.push({ el: el, text: t });
  }

  // 2) 从价格元素向上寻找「包含图片且有一定文字」的最近祖先，即商品卡片
  const items = [];
  const seen = new Set();
  for (let k = 0; k < priceEls.length; k++) {
    const pe = priceEls[k];
    let card = pe.el;
    let found = false;
    for (let i = 0; i < 6 && card.parentElement; i++) {
      const parent = card.parentElement;
      if (parent.querySelector('img') && clean(parent.textContent).length >= 6) {
        card = parent;
        found = true;
        break;
      }
      card = parent;
    }
    if (!found) continue;
    const cardText = clean(card.textContent);
    if (cardText.length > 400) continue;   // 卡片过大说明定位失败，跳过
    if (seen.has(card)) continue;
    seen.add(card);

    // 3) 在卡片内收集叶子文本块
    const blocks = [];
    const els = card.querySelectorAll('*');
    for (let j = 0; j < els.length; j++) {
      const e = els[j];
      if (e.children.length > 0) continue;
      const t = clean(e.textContent);
      if (t && t.length <= 120) blocks.push({ el: e, text: t });
    }

    // 4) 分离价格块与名称块
    const priceBlocks = blocks.filter((b) => priceRe.test(b.text) || numRe.test(b.text));
    const strikeBlocks = priceBlocks.filter((b) => isStrike(b.el));
    const liveBlocks = priceBlocks.filter((b) => !isStrike(b.el));

    let price = '';
    let original = '';
    if (liveBlocks.length > 0) price = liveBlocks[0].text;
    else if (priceBlocks.length > 0) price = priceBlocks[0].text;
    if (strikeBlocks.length > 0) original = strikeBlocks[0].text;
    else if (priceBlocks.length > 1) original = priceBlocks[priceBlocks.length - 1].text;

    // 名称：排除价格块与噪声词，优先取 DOM 顺序中第一个长度适中的文本块
    let name = '';
    const nameCandidates = blocks.filter(
      (b) => priceBlocks.indexOf(b) === -1 && !isNoise(b.text) && b.text.length >= 4
    );
    for (let m = 0; m < nameCandidates.length; m++) {
      if (nameCandidates[m].text.length <= 60) { name = nameCandidates[m].text; break; }
    }
    if (!name && nameCandidates.length > 0) {
      let best = nameCandidates[0];
      for (const c of nameCandidates) if (c.text.length > best.text.length) best = c;
      name = best.text;
    }

    const a = findLink(card);
    items.push({
      name: name,
      price: price,
      original_price: original,
      link: a ? a.href : '',
      card_text: cardText.slice(0, 300)
    });
  }
  return { mode: 'heuristic', items: items, shop: clean(document.title) };
}
"""

SCROLL_PAGE_JS = r"""
() => {
  // 优先滚动内部滚动容器（H5 列表常见），否则滚动窗口
  let best = null;
  let bestH = 0;
  const all = document.querySelectorAll('*');
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    const cs = getComputedStyle(el);
    const oy = cs.overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 80) {
      if (el.scrollHeight > bestH) { bestH = el.scrollHeight; best = el; }
    }
  }
  if (best) {
    best.scrollTop = best.scrollHeight;
    return { target: 'container', scrollHeight: best.scrollHeight, scrollTop: best.scrollTop };
  }
  window.scrollTo(0, document.body.scrollHeight);
  return { target: 'window', scrollHeight: document.body.scrollHeight, scrollTop: window.scrollY };
}
"""

CLICK_LOAD_MORE_JS = r"""
(texts) => {
  const els = Array.from(document.querySelectorAll('button, a, div, span, p'));
  for (const t of texts) {
    for (const el of els) {
      if (el.children.length === 0 && (el.textContent || '').replace(/\s+/g, '').indexOf(t) !== -1) {
        el.click();
        return t;
      }
    }
  }
  return null;
}
"""


# ---------------------------------------------------------------------------
# 配置与数据结构
# ---------------------------------------------------------------------------

@dataclass
class ScrapeConfig:
    urls: list
    output: Path
    user_data_dir: Path
    debug_dir: Path
    headless: bool = False
    mobile: bool = True
    max_scroll: int = 120
    scroll_pause: tuple = (0.8, 1.6)
    stable_rounds: int = 2
    page_timeout: int = 60
    login_timeout: int = 300
    selectors: dict = field(default_factory=dict)
    shop_name: str = ""
    interactive: bool = True
    debug_html: bool = False
    capture_api: bool = True
    channel: str = ""   # ""=自动检测；chromium=Playwright 自带；chrome/msedge=系统浏览器
    proxy: str = ""


@dataclass
class Product:
    shop: str
    name: str
    price_text: str
    price: object
    original_price_text: str
    original_price: object
    link: str
    scraped_at: str


# ---------------------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------------------

def log(msg: str) -> None:
    print("[{}] {}".format(datetime.now().strftime("%H:%M:%S"), msg), flush=True)


def human_pause(lo: float, hi: float) -> None:
    time.sleep(random.uniform(lo, hi))


def parse_price(text):
    """从 '¥13.9'、'13.9'、'13.9起' 等文本中解析数值，失败返回 None。"""
    if not text:
        return None
    m = re.search(r"(\d+(?:\.\d{1,2})?)", str(text).replace(",", ""))
    return float(m.group(1)) if m else None


def _has_login_cookie(context) -> bool:
    try:
        names = {c.get("name") for c in context.cookies()}
    except Exception:
        return False
    return bool(names & LOGIN_COOKIE_MARKERS)


# ---------------------------------------------------------------------------
# 浏览器探测：优先使用 Playwright 自带 Chromium，缺失时回退系统 Chrome/Edge
# ---------------------------------------------------------------------------

def _ms_playwright_cache_dir() -> Path:
    """Playwright 浏览器缓存目录（Windows: %LOCALAPPDATA%\\ms-playwright）。"""
    env = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    if env:
        return Path(env)
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home())
        return Path(base) / "ms-playwright"
    return Path.home() / ".cache" / "ms-playwright"


def _bundled_chromium_revision() -> str:
    """从驱动 browsers.json 读取自带 Chromium 的修订号。"""
    try:
        import playwright
        p = Path(playwright.__file__).resolve().parent / "driver" / "package" / "browsers.json"
        data = json.loads(p.read_text(encoding="utf-8"))
        for b in data.get("browsers", []):
            if b.get("name") == "chromium":
                return str(b.get("revision", ""))
    except Exception:
        pass
    return ""


def _bundled_chromium_installed() -> bool:
    rev = _bundled_chromium_revision()
    if not rev:
        return False
    exe = _ms_playwright_cache_dir() / ("chromium-" + rev) / "chrome-win64" / "chrome.exe"
    return exe.exists()


def _find_system_browser():
    """查找系统已安装的 Chrome / Edge，返回 (channel, 路径)；找不到返回 None。"""
    if sys.platform != "win32":
        return None
    pf = os.environ.get("ProgramFiles", r"C:\Program Files")
    pf86 = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
    local = os.environ.get("LOCALAPPDATA") or str(Path.home())
    candidates = [
        ("chrome", [
            Path(pf) / "Google" / "Chrome" / "Application" / "chrome.exe",
            Path(pf86) / "Google" / "Chrome" / "Application" / "chrome.exe",
            Path(local) / "Google" / "Chrome" / "Application" / "chrome.exe",
        ]),
        ("msedge", [
            Path(pf86) / "Microsoft" / "Edge" / "Application" / "msedge.exe",
            Path(pf) / "Microsoft" / "Edge" / "Application" / "msedge.exe",
        ]),
    ]
    for channel, paths in candidates:
        for p in paths:
            if p.exists():
                return channel, str(p)
    return None


def _looks_like_login(page) -> bool:
    try:
        if "login" in (page.url or "").lower():
            return True
        text = page.inner_text("body")[:2000]
    except Exception:
        return False
    return ("扫码登录" in text) or ("密码登录" in text)


def _extract(page, cfg: ScrapeConfig):
    return page.evaluate(
        EXTRACT_ITEMS_JS,
        {
            "itemSelector": cfg.selectors.get("item"),
            "nameSelector": cfg.selectors.get("name"),
            "priceSelector": cfg.selectors.get("price"),
            "originalPriceSelector": cfg.selectors.get("original_price"),
        },
    )


def _attach_api_capture(page, cfg: ScrapeConfig) -> None:
    """把疑似商品接口的 JSON 响应保存到 debug/api_capture/，便于二次分析。"""
    state = {"n": 0}
    cap_dir = cfg.debug_dir / "api_capture"
    try:
        cap_dir.mkdir(parents=True, exist_ok=True)
    except Exception:
        return
    keywords = ("mtop", "ele.me", "h5api", "/api/", "gateway")

    def on_response(resp):
        try:
            if state["n"] >= 300:
                return
            url = resp.url or ""
            if not any(k in url for k in keywords):
                return
            ct = (resp.headers or {}).get("content-type", "")
            if "json" not in ct:
                return
            body = resp.body()
            if not body or len(body) < 40 or len(body) > 2_000_000:
                return
            state["n"] += 1
            fname = "{:03d}.json".format(state["n"])
            (cap_dir / fname).write_bytes(body)
            with open(cap_dir / "index.jsonl", "a", encoding="utf-8") as f:
                f.write(json.dumps({"file": fname, "url": url, "status": resp.status},
                                   ensure_ascii=False) + "\n")
        except Exception:
            pass

    page.on("response", on_response)


# ---------------------------------------------------------------------------
# 登录
# ---------------------------------------------------------------------------

def ensure_login(context, cfg: ScrapeConfig, probe_url: str):
    """打开页面并等待登录。登录态保存在 user_data 目录，下次运行自动复用。"""
    page = context.new_page()
    try:
        page.goto(probe_url, timeout=cfg.page_timeout * 1000, wait_until="domcontentloaded")
    except Exception:
        pass

    if _has_login_cookie(context):
        log("检测到本地登录态，跳过登录。")
        return page

    log("首次运行需要登录：请在弹出的浏览器窗口中用【淘宝 App】扫描二维码完成登录。")
    log("（如页面出现滑块验证码，请在浏览器中手动拖动完成，脚本会持续等待）")

    deadline = time.time() + cfg.login_timeout
    last_tip = 0.0
    while time.time() < deadline:
        if _has_login_cookie(context):
            log("登录成功！登录态已保存到本地，后续运行无需重复登录。")
            return page
        if time.time() - last_tip > 20:
            last_tip = time.time()
            log("等待登录中... (剩余约 {} 秒)".format(int(deadline - time.time())))
        time.sleep(2)

    if cfg.interactive:
        log("自动检测登录超时。如果你已经登录成功，按回车继续；否则按 Ctrl+C 退出后重试。")
        try:
            input()
        except EOFError:
            pass
        return page
    raise RuntimeError("登录等待超时（{} 秒）。请调大 --login-timeout 或先用有界面模式完成登录。".format(cfg.login_timeout))


# ---------------------------------------------------------------------------
# 单个店铺抓取
# ---------------------------------------------------------------------------

def scrape_store(context, url: str, cfg: ScrapeConfig):
    """抓取单个店铺，返回 (店铺名, 商品 dict 列表)。"""
    page = context.new_page()
    if cfg.capture_api:
        _attach_api_capture(page, cfg)

    try:
        log("打开店铺页面: {}".format(url))
        try:
            page.goto(url, timeout=cfg.page_timeout * 1000, wait_until="domcontentloaded")
        except Exception as e:
            log("[WARN] 页面加载异常（将继续尝试提取）: {}".format(e))

        # 若被重定向到登录页，先完成登录再重新打开
        if _looks_like_login(page):
            log("页面跳转到了登录页，先完成登录...")
            page.close()
            page = ensure_login(context, cfg, url)
            try:
                page.goto(url, timeout=cfg.page_timeout * 1000, wait_until="domcontentloaded")
            except Exception:
                pass

        # 等待商品渲染
        log("等待商品列表渲染...")
        data = _wait_for_items(page, cfg)

        # 一个商品都没识别到时，允许人工介入（如选择城市/定位）
        if not data.get("items") and cfg.interactive:
            log("未自动识别到商品。若页面需要手动操作（如选择城市、定位、同意协议），")
            log("请在浏览器窗口中完成操作，然后回到这里按回车继续...")
            try:
                input()
            except EOFError:
                pass
            page.evaluate(SCROLL_PAGE_JS)
            human_pause(1.0, 2.0)
            data = _extract(page, cfg)

        # 滚动加载 + 跨轮次累计去重
        collected = {}

        def add(d):
            for it in (d or {}).get("items", []):
                key = it.get("link") or (it.get("name", "") + "|" + it.get("price", ""))
                if key and key not in collected:
                    collected[key] = it

        add(data)
        prev = len(collected)
        stable = 0
        for i in range(cfg.max_scroll):
            try:
                page.evaluate(CLICK_LOAD_MORE_JS, LOAD_MORE_TEXTS)
            except Exception:
                pass
            page.evaluate(SCROLL_PAGE_JS)
            human_pause(cfg.scroll_pause[0], cfg.scroll_pause[1])
            d = _extract(page, cfg)
            add(d)
            cnt = len(collected)
            if cnt != prev or (i + 1) % 10 == 0:
                log("  滚动第 {}/{} 轮，累计商品 {} 个".format(i + 1, cfg.max_scroll, cnt))
            if cnt <= prev:
                stable += 1
                if stable >= cfg.stable_rounds:
                    break
            else:
                stable = 0
            prev = cnt

        final = _extract(page, cfg)
        add(final)

        if cfg.debug_html:
            snap = cfg.debug_dir / "page_{}.html".format(datetime.now().strftime("%Y%m%d_%H%M%S"))
            try:
                snap.parent.mkdir(parents=True, exist_ok=True)
                snap.write_text(page.content(), encoding="utf-8")
                log("页面快照已保存: {}".format(snap))
            except Exception as e:
                log("[WARN] 页面快照保存失败: {}".format(e))

        shop = cfg.shop_name or (final.get("shop") or data.get("shop") or "")
        shop = shop.strip() or "未知店铺"
        return shop, list(collected.values())
    finally:
        try:
            page.close()
        except Exception:
            pass


def _wait_for_items(page, cfg: ScrapeConfig):
    deadline = time.time() + cfg.page_timeout
    data = {"items": [], "shop": "", "mode": ""}
    while time.time() < deadline:
        try:
            data = _extract(page, cfg)
        except Exception:
            data = {"items": [], "shop": "", "mode": ""}
        if data.get("items"):
            return data
        time.sleep(1.0)
    return data


def build_products(shop: str, items) -> list:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    out = []
    for it in items:
        name = (it.get("name") or "").strip()
        price_text = (it.get("price") or "").strip()
        if not name and not price_text:
            continue
        out.append(Product(
            shop=shop,
            name=name,
            price_text=price_text,
            price=parse_price(price_text),
            original_price_text=(it.get("original_price") or "").strip(),
            original_price=parse_price(it.get("original_price")),
            link=(it.get("link") or "").strip(),
            scraped_at=now,
        ))
    return out


# ---------------------------------------------------------------------------
# 导出
# ---------------------------------------------------------------------------

def export_csv(rows, path: Path) -> None:
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(CSV_HEADER)
        for idx, r in enumerate(rows, 1):
            w.writerow([idx, r.shop, r.name, r.price_text, r.price,
                        r.original_price_text, r.original_price, r.link, r.scraped_at])


def export_xlsx(rows, path: Path) -> None:
    if Workbook is None:
        raise RuntimeError("未安装 openpyxl，无法导出 Excel（可改用 --format csv）")
    wb = Workbook()
    ws = wb.active
    ws.title = "闪购商品"
    ws.append(CSV_HEADER)
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="4472C4")
        c.alignment = Alignment(horizontal="center", vertical="center")
    for idx, r in enumerate(rows, 1):
        ws.append([idx, r.shop, r.name, r.price_text, r.price,
                   r.original_price_text, r.original_price, r.link, r.scraped_at])
    widths = [6, 22, 46, 12, 10, 12, 10, 52, 20]
    for i, wd in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = wd
    for row in ws.iter_rows(min_row=2):
        row[4].number_format = "0.00"   # 价格(元)
        row[6].number_format = "0.00"   # 原价(元)
    ws.freeze_panes = "A2"
    wb.save(path)


# ---------------------------------------------------------------------------
# 商品名清单：给网页随机选择器用（导出 + 推送到站点）
# ---------------------------------------------------------------------------

def unique_names(rows) -> list:
    """提取去重后的商品名（保持首次出现顺序，清理多余空白）。"""
    seen, out = set(), []
    for r in rows:
        name = re.sub(r"\s+", " ", (r.name or "")).strip()
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(name)
    return out


def export_names(rows, path: Path):
    """导出商品名清单：.txt 每行一个名称，.json 带价格与店铺。"""
    names = unique_names(rows)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    txt_path = path.with_suffix(".txt")
    json_path = path.with_suffix(".json")
    txt_path.write_text("\n".join(names) + ("\n" if names else ""), encoding="utf-8")
    items = []
    seen = set()
    for r in rows:
        name = re.sub(r"\s+", " ", (r.name or "")).strip()
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        items.append({"name": name, "price": r.price, "shop": r.shop})
    json_path.write_text(json.dumps({
        "source": "taobao-shangou",
        "exportedAt": datetime.now().isoformat(timespec="seconds"),
        "count": len(items),
        "items": items,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return names, [txt_path, json_path]


def _http_json(url: str, method: str = "GET", payload=None, token: str = ""):
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:300]
        raise RuntimeError("HTTP {}: {}".format(e.code, detail))


def push_names(base_url: str, rows, token: str = "", user: str = "", password: str = ""):
    """把商品（名称 + 价格 + 店铺）推送到站点（PUT /api/waimai，需要管理员身份）。"""
    base = base_url.rstrip("/")
    if not token and user and password:
        login = _http_json(base + "/api/login", "POST", {"username": user, "password": password})
        token = login.get("token", "")
    if not token:
        raise RuntimeError("缺少管理员 token：请传 --push-token，或 --push-user/--push-pass")
    items = []
    seen = set()
    for r in rows:
        name = re.sub(r"\s+", " ", (r.name or "")).strip()
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        items.append({"name": name, "price": r.price, "shop": r.shop})
    return _http_json(base + "/api/waimai", "PUT", {
        "items": items,
        "source": "taobao-shangou",
    }, token)


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

def parse_args(argv=None):
    p = argparse.ArgumentParser(
        description="淘宝闪购店铺商品爬虫：抓取指定店铺的商品名称与价格，导出 CSV/Excel。",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("--url", action="append", default=[],
                   help="店铺页面链接，可重复传入多个")
    p.add_argument("--url-file",
                   help="包含店铺链接的文本文件（每行一个，# 开头为注释）")
    p.add_argument("--output",
                   help="输出文件路径（.csv 或 .xlsx），默认 output/淘宝闪购商品_时间戳.*")
    p.add_argument("--format", choices=["xlsx", "csv", "both"], default="both",
                   help="导出格式")
    p.add_argument("--user-data-dir", default=str(BASE_DIR / "user_data"),
                   help="浏览器用户数据目录（用于保存登录态，删除后需重新登录）")
    p.add_argument("--headless", action="store_true",
                   help="无头模式运行（需已保存登录态时使用）")
    p.add_argument("--desktop", action="store_true",
                   help="使用桌面浏览器模式（默认模拟手机访问 H5）")
    p.add_argument("--max-scroll", type=int, default=120,
                   help="最大滚动轮数")
    p.add_argument("--scroll-pause", default="0.8,1.6",
                   help="每次滚动后的随机停顿区间(秒)，例如 0.8,1.6")
    p.add_argument("--stable-rounds", type=int, default=2,
                   help="连续多少轮无新增商品即停止滚动")
    p.add_argument("--page-timeout", type=int, default=60,
                   help="等待商品渲染的超时时间(秒)")
    p.add_argument("--login-timeout", type=int, default=300,
                   help="等待扫码登录的超时时间(秒)")
    p.add_argument("--shop-name", default="",
                   help="手动指定店铺名（默认取页面标题）")
    p.add_argument("--selectors", default="",
                   help='自定义选择器 JSON，例如 {"item":".goods-item","name":".title","price":".price","original_price":".origin-price"}')
    p.add_argument("--debug-html", action="store_true",
                   help="保存页面 HTML 快照到 debug/ 目录")
    p.add_argument("--no-capture", action="store_true",
                   help="关闭接口 JSON 抓包（默认开启，保存到 debug/api_capture/）")
    p.add_argument("--no-prompt", action="store_true",
                   help="非交互模式：不等待人工介入（适合脚本化运行）")
    p.add_argument("--channel", choices=["chromium", "chrome", "msedge"], default=None,
                   help="浏览器通道：chromium=Playwright 自带（默认，需先执行 "
                        "python -m playwright install chromium）；chrome/msedge=驱动系统"
                        "已安装的浏览器；不指定时若未检测到自带浏览器会自动改用系统浏览器")
    p.add_argument("--proxy", default="",
                   help="HTTP 代理地址，例如 http://127.0.0.1:7890（默认使用系统代理设置）")
    p.add_argument("--export-names", default="",
                   help="额外导出纯商品名清单（.txt + .json），可直接导入网页随机选择器")
    p.add_argument("--push-url", default="",
                   help="把去重后的商品名推送到站点，例如 https://rhine-terminal.onrender.com")
    p.add_argument("--push-token", default="",
                   help="管理员 token（登录站点后可从 localStorage 的 rhine.auth 中取得）")
    p.add_argument("--push-user", default="",
                   help="管理员用户名（配合 --push-pass 自动登录获取 token）")
    p.add_argument("--push-pass", default="",
                   help="管理员密码")
    return p.parse_args(argv)


def collect_urls(args) -> list:
    urls = list(args.url or [])
    if args.url_file:
        p = Path(args.url_file)
        if not p.exists():
            raise FileNotFoundError("链接文件不存在: {}".format(args.url_file))
        for line in p.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                urls.append(line)
    if not urls:
        raise ValueError("请通过 --url 或 --url-file 提供至少一个店铺链接")
    # 去重并保持顺序
    seen, out = set(), []
    for u in urls:
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def parse_selectors(text: str) -> dict:
    if not text:
        return {}
    try:
        raw = json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError("--selectors 不是合法的 JSON: {}".format(e))
    out = {}
    for k in ("item", "name", "price", "original_price"):
        if raw.get(k):
            out[k] = str(raw[k]).strip()
    return out


def main(argv=None) -> int:
    args = parse_args(argv)

    try:
        urls = collect_urls(args)
    except (ValueError, FileNotFoundError) as e:
        log("[ERROR] {}".format(e))
        return 2

    try:
        selectors = parse_selectors(args.selectors)
    except ValueError as e:
        log("[ERROR] {}".format(e))
        return 2

    try:
        lo, hi = (float(x) for x in args.scroll_pause.split(","))
        if lo > hi:
            lo, hi = hi, lo
        scroll_pause = (max(0.1, lo), max(0.2, hi))
    except Exception:
        log("[ERROR] --scroll-pause 格式应为 \"最小值,最大值\"，例如 0.8,1.6")
        return 2

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    if args.output:
        out_path = Path(args.output)
    else:
        out_path = BASE_DIR / "output" / ("淘宝闪购商品_" + ts)

    cfg = ScrapeConfig(
        urls=urls,
        output=out_path,
        user_data_dir=Path(args.user_data_dir),
        debug_dir=BASE_DIR / "debug",
        headless=args.headless,
        mobile=not args.desktop,
        max_scroll=args.max_scroll,
        scroll_pause=scroll_pause,
        stable_rounds=args.stable_rounds,
        page_timeout=args.page_timeout,
        login_timeout=args.login_timeout,
        selectors=selectors,
        shop_name=args.shop_name,
        interactive=not args.no_prompt,
        debug_html=args.debug_html,
        capture_api=not args.no_capture,
        channel=args.channel or "",
        proxy=args.proxy,
    )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    cfg.user_data_dir.mkdir(parents=True, exist_ok=True)
    cfg.debug_dir.mkdir(parents=True, exist_ok=True)

    log("共 {} 个店铺待抓取，输出目录: {}".format(len(urls), out_path.parent))

    # 浏览器通道决策：显式指定 > 自带 Chromium > 系统 Chrome/Edge
    channel = cfg.channel
    if channel in ("", "chromium"):
        if channel == "" and not _bundled_chromium_installed():
            sys_browser = _find_system_browser()
            if sys_browser:
                channel = sys_browser[0]
                log("未检测到 Playwright 自带 Chromium，自动改用系统浏览器: {} ({})".format(
                    sys_browser[0], sys_browser[1]))
                log("如需使用自带浏览器，请先运行: python -m playwright install chromium")

    launch_kwargs = {}
    if channel:
        launch_kwargs["channel"] = channel
    if cfg.proxy:
        launch_kwargs["proxy"] = {"server": cfg.proxy}

    all_rows = []
    with sync_playwright() as p:
        try:
            context = p.chromium.launch_persistent_context(
                user_data_dir=str(cfg.user_data_dir),
                headless=cfg.headless,
                viewport={"width": 390, "height": 844} if cfg.mobile else {"width": 1440, "height": 900},
                user_agent=None if not cfg.mobile else MOBILE_UA,
                is_mobile=cfg.mobile,
                has_touch=cfg.mobile,
                locale="zh-CN",
                args=["--disable-blink-features=AutomationControlled"],
                **launch_kwargs,
            )
        except Exception as e:
            log("[ERROR] 浏览器启动失败: {}".format(e))
            log("若提示缺少 Chromium，请运行: python -m playwright install chromium")
            log("或改用系统已安装的浏览器: --channel chrome / --channel msedge")
            return 3
        context.set_default_timeout(cfg.page_timeout * 1000)
        try:
            page = ensure_login(context, cfg, urls[0])
            page.close()

            for i, url in enumerate(urls, 1):
                log("===== [{}/{}] 开始抓取 =====".format(i, len(urls)))
                try:
                    shop, items = scrape_store(context, url, cfg)
                    rows = build_products(shop, items)
                    all_rows.extend(rows)
                    log("店铺「{}」抓取完成：{} 个商品".format(shop, len(rows)))
                except KeyboardInterrupt:
                    raise
                except Exception as e:
                    log("[ERROR] 店铺抓取失败 ({}): {}".format(url, e))
                if i < len(urls):
                    human_pause(2.0, 4.0)   # 店铺间停顿，降低频率
        except KeyboardInterrupt:
            log("用户中断，先导出已抓取到的数据...")
        finally:
            try:
                context.close()
            except Exception:
                pass

    if not all_rows:
        log("未抓取到任何商品。可尝试: --debug-html 查看页面结构，或用 --selectors 指定选择器。")
        return 1

    written = []
    if args.format in ("csv", "both"):
        csv_path = out_path.with_suffix(".csv")
        export_csv(all_rows, csv_path)
        written.append(csv_path)
    if args.format in ("xlsx", "both"):
        xlsx_path = out_path.with_suffix(".xlsx")
        export_xlsx(all_rows, xlsx_path)
        written.append(xlsx_path)

    names = unique_names(all_rows)
    if args.export_names:
        _, name_files = export_names(all_rows, Path(args.export_names))
        written.extend(name_files)
        log("商品名清单已导出：{} 个不重复名称".format(len(names)))
    if args.push_url:
        try:
            meta = push_names(args.push_url, all_rows, args.push_token, args.push_user, args.push_pass)
            log("已推送 {} 个商品（含价格）到 {}{}".format(
                meta.get("count", len(names)), args.push_url,
                "（来源: {}）".format(meta.get("source")) if meta.get("source") else ""))
        except Exception as e:
            log("[ERROR] 推送失败: {}".format(e))

    # 按店铺统计
    stats = {}
    for r in all_rows:
        stats[r.shop] = stats.get(r.shop, 0) + 1

    log("抓取完成！共 {} 条商品记录。".format(len(all_rows)))
    for shop, cnt in stats.items():
        log("  - {}: {} 个商品".format(shop, cnt))
    for w in written:
        log("  - 已导出: {}".format(w))
    return 0


if __name__ == "__main__":
    sys.exit(main())
