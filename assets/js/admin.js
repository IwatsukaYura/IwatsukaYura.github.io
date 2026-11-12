/* 記事の執筆ページ（/admin/）。
   サーバーは持たず、ブラウザから GitHub API で content/posts/ を直接読み書きする。
   main へのコミットで deploy.yml が走り、数分後にサイトへ反映される。 */
(function () {
  "use strict";

  const root = document.getElementById("admin");
  if (!root) return;

  const REPO = root.dataset.repo;
  const BRANCH = root.dataset.branch;
  const SITE = (root.dataset.site || "/").replace(/\/?$/, "/");
  const API = "https://api.github.com";
  const POSTS_DIR = "content/posts";
  const TOKEN_KEY = "admin:token";
  const AUTOSAVE_PREFIX = "admin:autosave:";
  // mise run new と同じ制約（ファイル名がそのまま URL になる）
  const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;
  const KNOWN_KEYS = ["title", "date", "draft", "tags", "summary"];

  const $ = (id) => document.getElementById(id);
  const el = {
    status: $("admin-status"),
    auth: $("admin-auth"),
    tokenForm: $("token-form"),
    tokenInput: $("token-input"),
    home: $("admin-home"),
    list: $("post-list"),
    editor: $("editor"),
    state: $("post-state"),
    restore: $("restore"),
    restoreText: $("restore-text"),
    title: $("f-title"),
    name: $("f-name"),
    urlPreview: $("url-preview"),
    date: $("f-date"),
    tags: $("f-tags"),
    summary: $("f-summary"),
    extra: $("f-extra"),
    body: $("f-body"),
    image: $("f-image"),
    panes: $("panes"),
    preview: $("preview"),
    saveDraft: $("save-draft"),
    savePublish: $("save-publish"),
  };

  /* ---------- localStorage（使えない環境でも落とさない） ---------- */
  const store = {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch (e) {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
        return true;
      } catch (e) {
        return false;
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch (e) {
        /* 消せなくても次回の復元確認で破棄できる */
      }
    },
  };

  /* ---------- 状態表示 ---------- */
  function showStatus(message, kind) {
    el.status.textContent = "";
    el.status.className = "admin__status" + (kind ? " is-" + kind : "");
    if (message instanceof Node) el.status.appendChild(message);
    else el.status.textContent = message || "";
    // 保存ボタンはページ下部にあるので、結果が画面外なら見える位置まで戻す
    if (kind) {
      const rect = el.status.getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > window.innerHeight) {
        el.status.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }

  function fail(prefix, err) {
    const detail = err instanceof Error ? err.message : String(err);
    showStatus(prefix + ": " + detail, "error");
    console.error(prefix, err);
  }

  function show(section) {
    el.auth.hidden = section !== "auth";
    el.home.hidden = section !== "home";
    el.editor.hidden = section !== "editor";
  }

  /* ---------- GitHub API ---------- */
  let token = store.get(TOKEN_KEY) || "";

  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  function describeStatus(status, detail) {
    const suffix = detail ? "（" + detail + "）" : "";
    switch (status) {
      case 401:
        return "トークンが無効か期限切れです" + suffix;
      case 403:
        return "権限が足りません。Contents: Read and write が必要です" + suffix;
      case 404:
        return "見つかりません。トークンが " + REPO + " にアクセスできるか確認してください" + suffix;
      case 409:
        return "GitHub 上のファイルが、開いた後に別の場所で更新されています" + suffix;
      default:
        return "GitHub API エラー " + status + suffix;
    }
  }

  async function gh(path, options) {
    const opts = options || {};
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (opts.body) headers["Content-Type"] = "application/json";

    let res;
    try {
      res = await fetch(API + path, {
        method: opts.method || "GET",
        headers: headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        cache: "no-store",
      });
    } catch (e) {
      throw new Error("GitHub に接続できません。ネットワークを確認してください");
    }

    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.json()).message || "";
      } catch (e) {
        /* 本文が JSON でなければステータスだけで説明する */
      }
      throw new ApiError(res.status, describeStatus(res.status, detail));
    }
    return res.status === 204 ? null : res.json();
  }

  async function graphql(query, variables) {
    const data = await gh("/graphql", { method: "POST", body: { query: query, variables: variables } });
    if (data.errors && data.errors.length) {
      throw new Error(data.errors.map((e) => e.message).join(" / "));
    }
    return data.data;
  }

  function contentsPath(path) {
    return "/repos/" + REPO + "/contents/" + path.split("/").map(encodeURIComponent).join("/");
  }

  /* ---------- base64（UTF-8 / バイナリ） ---------- */
  function bytesToBase64(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }
  const encodeText = (text) => bytesToBase64(new TextEncoder().encode(text));
  function decodeText(b64) {
    const binary = atob(b64.replace(/\s/g, ""));
    return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  }

  /* ---------- front matter ---------- */
  class FrontMatterError extends Error {}

  function splitDocument(text) {
    const src = text.replace(/\r\n?/g, "\n");
    const m = src.match(/^---\n([\s\S]*?)\n?---[ \t]*(?:\n|$)/);
    if (!m) return { frontMatter: "", body: src };
    return { frontMatter: m[1], body: src.slice(m[0].length).replace(/^\n+/, "") };
  }

  function unquote(value) {
    const v = value.trim();
    if (/^".*"$/.test(v)) {
      try {
        return JSON.parse(v);
      } catch (e) {
        return v.slice(1, -1);
      }
    }
    if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
    return v;
  }

  const isBlank = (line) => line.trim() === "";

  function parseList(block) {
    const v = block.value;
    const children = block.children.filter((l) => !isBlank(l));
    if (v === "" && children.every((l) => /^\s*-\s+\S/.test(l))) {
      return children.map((l) => unquote(l.replace(/^\s*-\s+/, "")));
    }
    if (children.length === 0 && /^\[.*\]$/.test(v)) {
      const inner = v.slice(1, -1).trim();
      return inner === "" ? [] : inner.split(",").map(unquote).filter(Boolean);
    }
    return null;
  }

  /* 既知のキーだけをフォームに取り出し、それ以外は行のまま「その他」に残す */
  function parseFrontMatter(fm) {
    const fields = { title: "", date: "", draft: false, tags: [], summary: "" };
    const leading = [];
    const blocks = [];
    let current = null;
    for (const line of fm.split("\n")) {
      const m = line.match(/^([A-Za-z_][\w-]*)[ \t]*:(.*)$/);
      if (m) {
        current = { key: m[1], value: m[2].trim(), lines: [line], children: [] };
        blocks.push(current);
      } else if (current) {
        current.lines.push(line);
        current.children.push(line);
      } else {
        leading.push(line);
      }
    }

    const extra = leading.filter((l) => !isBlank(l));
    for (const b of blocks) {
      if (!KNOWN_KEYS.includes(b.key)) {
        extra.push(...b.lines);
        continue;
      }
      const simple = b.children.every(isBlank);
      if (b.key === "tags") {
        const tags = parseList(b);
        if (!tags) throw new FrontMatterError("tags の書き方を解釈できません");
        fields.tags = tags;
      } else if (!simple) {
        throw new FrontMatterError(b.key + " が複数行になっていて解釈できません");
      } else if (b.key === "draft") {
        if (b.value !== "true" && b.value !== "false") {
          throw new FrontMatterError("draft の値を解釈できません: " + b.value);
        }
        fields.draft = b.value === "true";
      } else {
        fields[b.key] = unquote(b.value);
      }
    }
    return { fields: fields, extra: extra.join("\n").replace(/\s+$/, "") };
  }

  function yamlTag(tag) {
    const plain =
      /^[\p{L}\p{N}][\p{L}\p{N} ._+/-]*$/u.test(tag) &&
      !/\s$/.test(tag) &&
      !/^(true|false|yes|no|on|off|null|~|[\d.+-]+)$/i.test(tag);
    return plain ? tag : JSON.stringify(tag);
  }

  function buildDocument(fields, extra, body) {
    const lines = [
      "---",
      "title: " + JSON.stringify(fields.title),
      "date: " + fields.date,
      "draft: " + fields.draft,
    ];
    if (fields.tags.length) {
      lines.push("tags:");
      fields.tags.forEach((t) => lines.push("  - " + yamlTag(t)));
    } else {
      lines.push("tags: []");
    }
    lines.push("summary: " + JSON.stringify(fields.summary));
    if (extra) lines.push(extra);
    lines.push("---", "");
    return lines.join("\n") + "\n" + body.replace(/\s+$/, "") + "\n";
  }

  function validateExtra(extra) {
    for (const line of extra.split("\n")) {
      if (/^---\s*$/.test(line)) return "その他の front matter に --- の行は書けません";
      const m = line.match(/^([A-Za-z_][\w-]*)[ \t]*:/);
      if (m && KNOWN_KEYS.includes(m[1])) {
        return "その他の front matter に " + m[1] + " は書けません（上の入力欄を使ってください）";
      }
    }
    return "";
  }

  /* ---------- 日付・URL ---------- */
  function nowJST() {
    const d = new Date(Date.now() + 9 * 3600 * 1000);
    return d.toISOString().slice(0, 19) + "+09:00";
  }

  function postUrl(name, date) {
    if (!NAME_RE.test(name) || !DATE_RE.test(date)) return "";
    return SITE + date.slice(0, 4) + "/" + date.slice(5, 7) + "/" + name + "/";
  }

  /* ---------- 記事一覧 ---------- */
  const LIST_QUERY = `query($owner: String!, $name: String!, $expr: String!) {
    repository(owner: $owner, name: $name) {
      object(expression: $expr) {
        ... on Tree {
          entries {
            name
            type
            object {
              ... on Blob { text }
              ... on Tree { entries { name object { ... on Blob { text } } } }
            }
          }
        }
      }
    }
  }`;

  let posts = [];

  function summarize(name, path, text) {
    const post = { name: name, path: path, title: name, date: "", draft: false, broken: false };
    if (typeof text !== "string") return Object.assign(post, { broken: true });
    try {
      const fields = parseFrontMatter(splitDocument(text).frontMatter).fields;
      return Object.assign(post, { title: fields.title || name, date: fields.date, draft: fields.draft });
    } catch (e) {
      return Object.assign(post, { broken: true });
    }
  }

  async function loadPosts() {
    const parts = REPO.split("/");
    const data = await graphql(LIST_QUERY, {
      owner: parts[0],
      name: parts[1],
      expr: BRANCH + ":" + POSTS_DIR,
    });
    const tree = data.repository && data.repository.object;
    if (!tree || !tree.entries) throw new Error(POSTS_DIR + " が見つかりません");

    posts = [];
    for (const entry of tree.entries) {
      if (entry.type === "blob" && /\.md$/.test(entry.name) && entry.name !== "_index.md") {
        const name = entry.name.replace(/\.md$/, "");
        posts.push(summarize(name, POSTS_DIR + "/" + entry.name, entry.object && entry.object.text));
      } else if (entry.type === "tree" && entry.object && entry.object.entries) {
        // ページバンドル（posts/<name>/index.md）
        const index = entry.object.entries.find((e) => e.name === "index.md");
        if (index) {
          posts.push(summarize(entry.name, POSTS_DIR + "/" + entry.name + "/index.md", index.object && index.object.text));
        }
      }
    }
    posts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  function renderList() {
    el.list.textContent = "";
    if (!posts.length) {
      const li = document.createElement("li");
      li.className = "admin-list__empty";
      li.textContent = "記事がまだありません";
      el.list.appendChild(li);
      return;
    }
    for (const post of posts) {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "admin-list__item";
      btn.addEventListener("click", () => openPost(post.path));

      const meta = document.createElement("span");
      meta.className = "admin-list__meta";
      const badge = document.createElement("span");
      badge.className = "admin-list__badge" + (post.draft ? " is-draft" : "");
      badge.textContent = post.broken ? "?" : post.draft ? "draft" : "公開中";
      meta.append(badge, (post.date ? post.date.slice(0, 10).replace(/-/g, ".") : "----.--.--") + "  " + post.name);

      const title = document.createElement("span");
      title.className = "admin-list__title";
      title.textContent = post.title;

      btn.append(title, meta);
      li.appendChild(btn);
      el.list.appendChild(li);
    }
  }

  async function goHome(message) {
    show("home");
    showStatus(message || "記事を読み込んでいます…");
    try {
      await loadPosts();
      renderList();
      if (!message) showStatus("");
    } catch (err) {
      fail("一覧を読み込めませんでした", err);
    }
  }

  /* ---------- エディタ ---------- */
  // path: 保存先（新規は保存まで null）/ sha: 楽観ロック用 / published: 開いた時点で公開中か
  let current = null;
  let dirty = false;

  function readForm() {
    return {
      title: el.title.value.trim(),
      name: el.name.value.trim(),
      date: el.date.value.trim(),
      tags: el.tags.value
        .split(/[,、]/)
        .map((t) => t.trim())
        .filter(Boolean),
      summary: el.summary.value.trim(),
      extra: el.extra.value.replace(/\s+$/, ""),
      body: el.body.value,
    };
  }

  function writeForm(form) {
    el.title.value = form.title;
    el.name.value = form.name;
    el.date.value = form.date;
    el.tags.value = form.tags.join(", ");
    el.summary.value = form.summary;
    el.extra.value = form.extra;
    el.extra.closest("details").open = form.extra !== "";
    el.body.value = form.body;
    refreshDerived();
    renderPreview();
  }

  function refreshDerived() {
    const url = postUrl(el.name.value.trim(), el.date.value.trim());
    el.urlPreview.textContent = url ? url : "英小文字・数字・ハイフンのみ。そのまま URL になります";
    el.name.readOnly = !!(current && current.path);

    let state = "新規（未保存）";
    if (current && current.path) state = (current.published ? "公開中" : "下書き") + " — " + current.path;
    if (dirty) state += " ・ 未保存の変更あり";
    el.state.textContent = state;
    el.saveDraft.textContent = current && current.published ? "下書きに戻す" : "下書き保存";
    el.savePublish.textContent = current && current.published ? "更新を公開" : "公開する";
  }

  let previewTimer = 0;
  function renderPreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      try {
        el.preview.innerHTML = window.marked.parse(el.body.value, { gfm: true, breaks: false });
      } catch (err) {
        el.preview.textContent = "プレビューを表示できません: " + (err instanceof Error ? err.message : String(err));
      }
    }, 120);
  }

  /* 入力途中の内容はタブを閉じても消えないようにブラウザへ退避する */
  const autosaveKey = () => AUTOSAVE_PREFIX + ((current && current.path) || "new");
  let autosaveTimer = 0;
  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      store.set(autosaveKey(), JSON.stringify({ savedAt: Date.now(), form: readForm() }));
    }, 600);
  }

  function offerRestore(loaded) {
    el.restore.hidden = true;
    const raw = store.get(autosaveKey());
    if (!raw) return;
    let saved;
    try {
      saved = JSON.parse(raw);
    } catch (e) {
      store.remove(autosaveKey());
      return;
    }
    if (!saved || !saved.form || JSON.stringify(saved.form) === JSON.stringify(loaded)) {
      store.remove(autosaveKey());
      return;
    }
    el.restoreText.textContent =
      new Date(saved.savedAt).toLocaleString("ja-JP") + " に入力していた未保存の内容があります。";
    el.restore.hidden = false;
    $("restore-apply").onclick = () => {
      writeForm(saved.form);
      dirty = true;
      refreshDerived();
      el.restore.hidden = true;
    };
    $("restore-discard").onclick = () => {
      store.remove(autosaveKey());
      el.restore.hidden = true;
    };
  }

  function openEditor(form) {
    dirty = false;
    writeForm(form);
    show("editor");
    offerRestore(form);
    setPane("write");
    window.scrollTo(0, 0);
  }

  function newPost() {
    current = { path: null, sha: null, published: false };
    showStatus("");
    openEditor({ title: "", name: "", date: nowJST(), tags: [], summary: "", extra: "", body: "" });
    el.title.focus();
  }

  async function openPost(path) {
    showStatus("記事を読み込んでいます…");
    try {
      const file = await gh(contentsPath(path) + "?ref=" + encodeURIComponent(BRANCH));
      const doc = splitDocument(decodeText(file.content));
      const parsed = parseFrontMatter(doc.frontMatter);
      const name = path.endsWith("/index.md") ? path.split("/").slice(-2, -1)[0] : path.split("/").pop().replace(/\.md$/, "");
      current = { path: path, sha: file.sha, published: !parsed.fields.draft };
      showStatus("");
      openEditor({
        title: parsed.fields.title,
        name: name,
        date: parsed.fields.date,
        tags: parsed.fields.tags,
        summary: parsed.fields.summary,
        extra: parsed.extra,
        body: doc.body,
      });
    } catch (err) {
      if (err instanceof FrontMatterError) {
        fail("この記事は front matter を解釈できないため、ここでは編集できません（手元で編集してください）", err);
      } else {
        fail("記事を開けませんでした", err);
      }
    }
  }

  function validate(form) {
    if (!form.title) return "タイトルを入力してください";
    if (!NAME_RE.test(form.name)) return "URL 名は英小文字・数字・ハイフンのみにしてください: " + form.name;
    if (!DATE_RE.test(form.date)) return "日付は 2026-01-02T10:00:00+09:00 の形式で入力してください";
    const extraError = validateExtra(form.extra);
    if (extraError) return extraError;
    if (!current.path && posts.some((p) => p.name === form.name)) {
      return "同じ URL 名の記事が既にあります: " + form.name;
    }
    return "";
  }

  let busy = false;
  function setBusy(value) {
    busy = value;
    el.saveDraft.disabled = value;
    el.savePublish.disabled = value;
  }

  async function save(draft) {
    if (busy) return;
    const form = readForm();
    const error = validate(form);
    if (error) {
      showStatus(error, "error");
      return;
    }

    if (!draft && !window.confirm("「" + form.title + "」を公開しますか？\n" + BRANCH + " にコミットされ、数分後にサイトへ反映されます。")) {
      return;
    }
    if (draft && current.published && !window.confirm("公開中の記事を下書きに戻します。サイトから見えなくなります。よろしいですか？")) {
      return;
    }

    const path = current.path || POSTS_DIR + "/" + form.name + ".md";
    const content = buildDocument(
      { title: form.title, date: form.date, draft: draft, tags: form.tags, summary: form.summary },
      form.extra,
      form.body
    );
    const body = {
      message: (draft ? "draft: " : "post: ") + form.title,
      content: encodeText(content),
      branch: BRANCH,
    };
    if (current.sha) body.sha = current.sha;

    setBusy(true);
    showStatus("保存しています…");
    try {
      const res = await gh(contentsPath(path), { method: "PUT", body: body });
      const wasNew = !current.path;
      store.remove(autosaveKey());
      current = { path: path, sha: res.content.sha, published: !draft };
      if (wasNew) posts.push({ name: form.name, path: path, title: form.title, date: form.date, draft: draft });
      dirty = false;
      refreshDerived();
      showStatus(savedMessage(draft, form), "ok");
    } catch (err) {
      if (err instanceof ApiError && (err.status === 409 || (err.status === 422 && !current.sha))) {
        fail(
          current.sha
            ? "保存できませんでした。入力内容はこのブラウザに退避済みなので、一覧から開き直すと復元できます"
            : "保存できませんでした。同じ名前のファイルが既にあります",
          err
        );
      } else {
        fail("保存できませんでした", err);
      }
    } finally {
      setBusy(false);
    }
  }

  function savedMessage(draft, form) {
    const frag = document.createDocumentFragment();
    if (draft) {
      frag.append("下書きとして保存しました。");
    } else {
      frag.append("公開しました。デプロイが終わると ");
      const a = document.createElement("a");
      a.href = postUrl(form.name, form.date);
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = a.href;
      frag.append(a, " で読めます。");
    }
    const actions = document.createElement("a");
    actions.href = "https://github.com/" + REPO + "/actions";
    actions.target = "_blank";
    actions.rel = "noopener";
    actions.textContent = "デプロイの状況 ↗";
    frag.append(" ", actions);
    return frag;
  }

  /* ---------- 画像アップロード（static/images/YYYY/MM/ へコミット） ---------- */
  function imageFileName(file) {
    const ext = (file.name.match(/\.([a-z0-9]+)$/i) || [, file.type.split("/")[1] || "png"])[1].toLowerCase();
    const base = file.name
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
    const stamp = new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace(/\D/g, "").slice(0, 14);
    return stamp + (base ? "-" + base : "") + "." + ext;
  }

  function insertAtCursor(text) {
    const start = el.body.selectionStart;
    const end = el.body.selectionEnd;
    el.body.setRangeText(text, start, end, "end");
    el.body.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function uploadImages(files) {
    const images = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!images.length) return;
    const ym = nowJST().slice(0, 7).replace("-", "/");
    for (const file of images) {
      if (file.size > 20 * 1024 * 1024) {
        showStatus(file.name + " は 20MB を超えるためアップロードできません", "error");
        continue;
      }
      const name = imageFileName(file);
      const placeholder = "![アップロード中: " + name + "]()";
      insertAtCursor(placeholder);
      showStatus("画像をアップロードしています: " + file.name);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        await gh(contentsPath("static/images/" + ym + "/" + name), {
          method: "PUT",
          body: { message: "chore: add image " + name, content: bytesToBase64(bytes), branch: BRANCH },
        });
        el.body.value = el.body.value.replace(placeholder, "![](/images/" + ym + "/" + name + ")");
        showStatus("画像をアップロードしました（プレビューにはデプロイ後に表示されます）", "ok");
      } catch (err) {
        el.body.value = el.body.value.replace(placeholder, "");
        fail("画像をアップロードできませんでした", err);
      }
      el.body.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  /* ---------- 書く / プレビュー の切り替え（狭い画面用） ---------- */
  function setPane(pane) {
    el.panes.dataset.pane = pane;
    document.querySelectorAll(".admin__tab").forEach((tab) => {
      tab.classList.toggle("is-current", tab.dataset.pane === pane);
    });
  }

  /* ---------- 接続 ---------- */
  async function connect(candidate) {
    const previous = token;
    token = candidate;
    showStatus("接続しています…");
    try {
      const repo = await gh("/repos/" + REPO);
      if (!repo.permissions || !repo.permissions.push) {
        throw new Error("このトークンには " + REPO + " への書き込み権限がありません");
      }
      store.set(TOKEN_KEY, token);
      await goHome();
    } catch (err) {
      token = previous;
      if (err instanceof ApiError && err.status === 401) {
        token = "";
        store.remove(TOKEN_KEY);
      }
      show("auth");
      fail("接続できませんでした", err);
    }
  }

  /* ---------- イベント ---------- */
  el.tokenForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = el.tokenInput.value.trim();
    if (value) connect(value);
  });

  $("logout").addEventListener("click", () => {
    if (!window.confirm("このブラウザからトークンを削除しますか？")) return;
    token = "";
    store.remove(TOKEN_KEY);
    el.tokenInput.value = "";
    show("auth");
    showStatus("接続を解除しました");
  });

  $("new-post").addEventListener("click", newPost);
  $("reload-list").addEventListener("click", () => goHome());
  $("back").addEventListener("click", () => {
    if (dirty && !window.confirm("未保存の変更があります（このブラウザには退避済みです）。一覧に戻りますか？")) return;
    dirty = false;
    goHome();
  });

  el.editor.addEventListener("input", (e) => {
    if (e.target === el.image) return;
    dirty = true;
    refreshDerived();
    scheduleAutosave();
    if (e.target === el.body) renderPreview();
  });
  el.editor.addEventListener("submit", (e) => e.preventDefault());
  el.saveDraft.addEventListener("click", () => save(true));
  el.savePublish.addEventListener("click", () => save(false));

  document.querySelectorAll(".admin__tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      if (tab.dataset.pane === "preview") renderPreview();
      setPane(tab.dataset.pane);
    });
  });

  el.image.addEventListener("change", () => {
    uploadImages(el.image.files);
    el.image.value = "";
  });
  el.body.addEventListener("paste", (e) => {
    const files = e.clipboardData && e.clipboardData.files;
    if (files && files.length) {
      e.preventDefault();
      uploadImages(files);
    }
  });
  el.body.addEventListener("dragover", (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
  });
  el.body.addEventListener("drop", (e) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) {
      e.preventDefault();
      uploadImages(files);
    }
  });

  // Ctrl/Cmd+S で下書き保存（ブラウザの「ページを保存」を出さない）
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s" && !el.editor.hidden) {
      e.preventDefault();
      save(current && current.published ? false : true);
    }
  });

  window.addEventListener("beforeunload", (e) => {
    if (dirty) e.preventDefault();
  });

  /* ---------- 起動 ---------- */
  if (!window.marked) {
    showStatus("Markdown のライブラリを読み込めませんでした。プレビューは使えません", "error");
    window.marked = { parse: (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]) };
  }
  if (token) connect(token);
  else show("auth");
})();
