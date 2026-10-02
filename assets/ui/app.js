"use strict";
// Crizon AI — trình quản lý trên máy. Không thư viện; CSP chặn script nội tuyến nên
// mọi sự kiện gắn qua delegation. Token API nhận một lần qua #fragment rồi xoá khỏi URL.
(() => {
  const COPY = {
    vi: {
      sub: "Trên máy này",
      quit: "Đóng trình quản lý",
      closed: "Đã đóng trình quản lý. Chạy lại bằng lệnh crizon-ai ui.",
      noToken: "Trang này cần mở bằng lệnh crizon-ai ui (link có mã bảo vệ).",
      nav: { account: "Tài khoản", apps: "Ứng dụng", check: "Kiểm tra kết nối", mcp: "MCP", skills: "Skill", rank: "Bảng xếp hạng" },
      copy: "Sao chép",
      copied: "Đã sao chép",
      error: "Có lỗi xảy ra",
      close: "Đóng",
      loading: "Đang tải…",
      account: {
        title: "Tài khoản",
        sub: "API key Crizon dùng cho mọi ứng dụng trên máy này.",
        connected: "Đã có API key",
        noKey: "Chưa có API key",
        noKeyBody: "Đăng nhập bằng trình duyệt để tự tạo key cho máy này, hoặc dán key có sẵn.",
        fromEnv: "Đang lấy từ biến môi trường CRIZON_API_KEY",
        envNote: "Key đang lấy từ biến môi trường CRIZON_API_KEY nên luôn được ưu tiên. Gỡ biến đó nếu muốn dùng key lưu ở đây.",
        browserLogin: "Đăng nhập bằng trình duyệt",
        paste: "Dán API key",
        replace: "Dán key khác",
        remove: "Gỡ key",
        save: "Lưu",
        cancel: "Huỷ",
        keyPlaceholder: "czn_…",
        keyLabel: "API key",
        keyNote: "Key được kiểm tra với Gateway trước khi lưu, rồi tự cập nhật cho mọi ứng dụng đang bật.",
        waiting: "Đang chờ bạn bấm Cho phép trên trình duyệt…",
        loginOk: (label) => `Đã đăng nhập — key "${label}" đã lưu trên máy này`,
        loginFail: "Chưa đăng nhập được",
        saved: "Đã lưu key mới",
        savedUnverified: "Đã lưu key (chưa kiểm tra được vì không kết nối được Gateway)",
        invalidKey: "Gateway từ chối key này nên chưa lưu",
        removed: "Đã gỡ key khỏi máy này",
        modelSection: "Model",
        model: "Model mặc định",
        modelAuto: "Tự động (model đầu tiên của gói)",
        modelLoading: "Đang tải danh sách model…",
        modelNote: "Đổi key hoặc model sẽ tự cập nhật cho mọi ứng dụng đang bật.",
        modelSaved: "Đã đổi model mặc định",
        linkSection: "Kết nối",
        gateway: "Gateway",
        manage: "Quản lý key trên web",
        open: "Mở",
        updated: (names) => `Đã cập nhật cho: ${names}`,
      },
      apps: {
        title: "Ứng dụng",
        sub: "Bật để ứng dụng dùng Crizon AI. Tắt để trả lại cấu hình cũ của bạn.",
        needKey: "Thêm API key trước rồi mới bật được ứng dụng.",
        addKey: "Thêm key",
        on: (command, newTerminal) => newTerminal ? `Đang dùng Crizon · mở terminal mới rồi chạy ${command}` : `Đang dùng Crizon · chạy ${command}`,
        off: "Đã cài · đang tắt",
        notInstalled: "Chưa cài",
        switchLabel: (name) => `Dùng Crizon cho ${name}`,
        turnedOn: (name, command, newTerminal) => newTerminal ? `Đã bật Crizon cho ${name} — mở cửa sổ terminal mới rồi chạy ${command}` : `Đã bật Crizon cho ${name} — chạy ${command} là dùng được`,
        turnedOff: (name) => `Đã tắt Crizon cho ${name} và trả lại cấu hình cũ`,
        backup: (path) => `Bản sao lưu: ${path}`,
        conflict: (path) => `${path} đã có cấu hình provider "crizon" do bạn tự viết. Gỡ phần đó rồi bật lại.`,
        backupNote: "Crizon luôn sao lưu file cấu hình trước khi sửa (đuôi .crizon-backup-…).",
      },
      check: {
        title: "Kiểm tra kết nối",
        sub: "Thử key với Gateway và kiểm tra Gateway có hỗ trợ chuẩn API mà từng ứng dụng dùng.",
        run: "Kiểm tra ngay",
        gateway: "Gateway & API key",
        gatewayOk: (count) => `Kết nối được · ${count} model trong gói`,
        gatewayErr: (code) => code === "no_key" ? "Chưa có API key" : code === "network_error" ? "Không kết nối được Gateway" : `Gateway trả lỗi: ${code}`,
        ok: "Ổn",
        fail: "Lỗi",
        supported: "Hỗ trợ",
        unsupported: "Chưa hỗ trợ",
        unreachable: "Không kết nối được",
      },
      mcp: {
        title: "MCP",
        sub: "MCP server cho ứng dụng AI thêm công cụ: đọc file, GitHub, trình duyệt… Bật hoặc tắt riêng cho từng ứng dụng.",
        add: "Thêm MCP",
        search: "Tìm MCP",
        count: (n) => `${n} server`,
        empty: "Chưa có MCP server nào trên máy này.",
        noMatch: "Không có MCP nào khớp.",
        appsTitle: "Ứng dụng",
        states: { on: "Đang bật", off: "Đang tắt", absent: "Chưa có — bật để chép sang", unsupported: "Ứng dụng này không chạy được loại server này", missing: "Chưa cài ứng dụng", error: "Không đọc được file cấu hình" },
        kinds: { stdio: "Chạy trên máy (stdio)", http: "Qua mạng (HTTP)", sse: "Qua mạng (SSE)", unknown: "Không rõ" },
        kind: "Loại",
        command: "Lệnh",
        url: "Địa chỉ",
        envKeys: "Biến môi trường",
        headerKeys: "Header",
        secretsNote: "Giá trị biến môi trường và header chỉ nằm trên máy này; trang không bao giờ hiển thị.",
        restart: "Mở lại ứng dụng (hoặc phiên chat mới) để áp dụng thay đổi.",
        switchLabel: (name, app) => `Bật ${name} cho ${app}`,
        turnedOn: (name, app) => `Đã bật ${name} cho ${app}`,
        turnedOff: (name, app) => `Đã tắt ${name} cho ${app}`,
        removeAll: "Xoá khỏi mọi ứng dụng",
        confirmRemove: "Bấm lần nữa để xoá",
        removed: (name) => `Đã xoá ${name}`,
        form: {
          title: "Thêm MCP server",
          name: "Tên",
          namePh: "vd. github",
          type: "Loại",
          command: "Lệnh",
          args: "Tham số — mỗi dòng một tham số",
          env: "Biến môi trường — mỗi dòng KEY=giá trị",
          url: "URL",
          headers: "Header — mỗi dòng Tên: giá trị",
          apps: "Cài vào",
          next: "Xem trước",
          back: "Sửa lại",
          confirm: "Cài",
          review: "Crizon sẽ ghi đúng cấu hình này (giá trị bí mật đã che):",
          files: "Vào các file:",
          unpinned: "Gói chưa ghim phiên bản (vd. @1.2.3) — bản mới phát hành có thể tự đổi hành vi.",
          added: (name) => `Đã thêm ${name}`,
        },
        errors: {
          exists: "Đã có MCP trùng tên.",
          invalid_name: "Tên chỉ gồm chữ, số, - và _ (tối đa 64 ký tự).",
          invalid_def: "Thông tin server chưa hợp lệ.",
          unsupported_kind: "Có ứng dụng không chạy được loại server này.",
          app_missing: "Ứng dụng chưa được cài trên máy.",
          config_unreadable: "Không đọc được file cấu hình của ứng dụng (sai định dạng JSON?). Crizon không ghi đè.",
          not_found: "Không tìm thấy server.",
          no_apps: "Chọn ít nhất một ứng dụng.",
        },
      },
      skills: {
        title: "Skill",
        sub: "Skill là bộ hướng dẫn và script giúp agent làm việc chuyên môn (PDF, Excel, thiết kế…). Bật hoặc tắt riêng cho Claude Code và Codex.",
        install: "Cài từ GitHub",
        search: "Tìm skill",
        count: (n) => `${n} skill`,
        empty: "Chưa có skill nào trên máy này.",
        noMatch: "Không có skill nào khớp.",
        appsTitle: "Ứng dụng",
        states: { on: "Đang bật", off: "Đang tắt", absent: "Chưa có — bật để chép sang", missing: "Chưa cài ứng dụng" },
        folder: "Thư mục",
        restart: "Mở phiên mới của ứng dụng để thấy thay đổi.",
        switchLabel: (name, app) => `Bật ${name} cho ${app}`,
        turnedOn: (name, app) => `Đã bật ${name} cho ${app}`,
        turnedOff: (name, app) => `Đã tắt ${name} cho ${app}`,
        removeAll: "Xoá khỏi mọi ứng dụng",
        confirmRemove: "Bấm lần nữa để xoá",
        removed: (name) => `Đã chuyển ${name} vào thùng rác của Crizon`,
        trashNote: "Xoá = chuyển vào ~/.crizon-ai/trash, lấy lại được khi cần.",
        gh: {
          title: "Cài skill từ GitHub",
          url: "Link thư mục skill trên GitHub",
          urlPh: "https://github.com/anthropics/skills/tree/main/skills/pdf",
          next: "Xem trước",
          loading: "Đang đọc từ GitHub…",
          source: "Nguồn",
          pinned: "Ghim theo commit",
          files: (n, size) => `${n} file · ${size}`,
          apps: "Cài vào",
          back: "Đổi link",
          confirm: "Cài",
          note: "Chỉ cài skill từ nguồn bạn tin tưởng: skill có thể kèm script mà agent sẽ chạy trên máy bạn.",
          installed: (name) => `Đã cài ${name}`,
        },
        errors: {
          invalid_url: "Link cần dạng https://github.com/<chủ>/<repo>/tree/<nhánh>/<thư mục>.",
          github_not_found: "Không tìm thấy repo, nhánh hoặc thư mục trên GitHub.",
          github_rate_limited: "GitHub đang giới hạn lượt gọi. Thử lại sau ít phút.",
          github_error: "GitHub trả lỗi, thử lại sau.",
          no_skill_md: "Thư mục này không có SKILL.md nên không phải skill.",
          too_large: "Skill quá lớn (tối đa 100 file, 2 MB).",
          exists: "Đã có skill trùng tên thư mục.",
          invalid_name: "Tên thư mục skill không hợp lệ.",
          app_missing: "Ứng dụng chưa được cài trên máy.",
          not_found: "Không tìm thấy skill.",
          no_apps: "Chọn ít nhất một ứng dụng.",
        },
      },
      rank: {
        title: "Bảng xếp hạng",
        sub: "MCP và skill được cộng đồng dùng nhiều, cập nhật hằng ngày từ MCP Registry và GitHub. Bấm vào để xem tác dụng và cài ngay.",
        tabs: { featured: "Đề xuất", hot: "Đang hot" },
        kinds: { "": "Tất cả", MCP: "MCP", SKILL: "Skill" },
        search: "Tìm trong kho",
        hotNote: "Đang hot được lấy tự động theo số sao tăng trên GitHub và chưa được Crizon kiểm duyệt — xem kỹ trước khi cài.",
        featuredEmpty: "Chưa có mục đề xuất nào. Xem tab Đang hot nhé.",
        empty: "Không có mục nào khớp.",
        unreachable: "Chưa tải được kho — kiểm tra kết nối mạng rồi thử lại.",
        retry: "Thử lại",
        perWeek: (n) => `+${n}/tuần`,
        verified: "Crizon đã duyệt",
        unverified: "Chưa kiểm duyệt",
        installedIn: (names) => `Đã cài ở ${names}`,
        kind: "Loại",
        kindMcp: (runtime) => `MCP server${runtime ? ` · ${runtime}` : ""}`,
        kindSkill: "Skill",
        version: "Phiên bản ghim",
        stars: "Sao GitHub",
        week: "Tăng 7 ngày qua",
        source: "Nguồn",
        original: "Mô tả gốc (tiếng Anh)",
        howTo: "Crizon sẽ cài bằng",
        values: "Thông tin cần nhập",
        required: "bắt buộc",
        optional: "không bắt buộc",
        secretNote: "Giá trị bạn nhập chỉ được ghi vào cấu hình ứng dụng trên máy này, không gửi lên Crizon.",
        apps: "Cài vào",
        install: "Cài",
        manage: "Quản lý",
        installed: (name) => `Đã cài ${name}`,
        unverifiedWarn: "Mục này chưa được Crizon kiểm duyệt. MCP/skill chạy lệnh trên máy bạn — chỉ cài khi bạn tin nguồn này.",
        dockerNote: "Cần Docker đang chạy trên máy.",
        about: "Giới thiệu",
        what: "Nó làm gì",
        features: "Tính năng chính",
        when: "Khi nào nên dùng",
        needs: "Cần chuẩn bị",
        readme: "Giới thiệu từ repo (tiếng Anh)",
        skillDoc: "Nội dung skill (tiếng Anh)",
        readMore: "Xem toàn bộ",
        images: "Hình ảnh",
        license: "Giấy phép",
        homepage: "Trang chủ",
        loadingDetail: "Đang tải giới thiệu từ repo…",
        noDetail: "Repo này chưa có phần giới thiệu.",
        errors: { missing_value: (name) => `Cần nhập ${name}.`, catalog_unreachable: "Không kết nối được kho Crizon.", catalog_not_found: "Mục này không còn trong kho.", unsupported_install: "Mục này chưa cài tự động được." },
      },
    },
    en: {
      sub: "On this computer",
      quit: "Close manager",
      closed: "The manager is closed. Run crizon-ai ui to open it again.",
      noToken: "Open this page with the crizon-ai ui command (the link carries a security code).",
      nav: { account: "Account", apps: "Apps", check: "Connection check", mcp: "MCP", skills: "Skills", rank: "Leaderboard" },
      copy: "Copy",
      copied: "Copied",
      error: "Something went wrong",
      close: "Close",
      loading: "Loading…",
      account: {
        title: "Account",
        sub: "The Crizon API key used by every app on this computer.",
        connected: "API key added",
        noKey: "No API key yet",
        noKeyBody: "Sign in with your browser to create a key for this computer, or paste an existing key.",
        fromEnv: "Read from the CRIZON_API_KEY environment variable",
        envNote: "The key comes from the CRIZON_API_KEY environment variable, which always wins. Remove that variable to use the key saved here.",
        browserLogin: "Sign in with browser",
        paste: "Paste API key",
        replace: "Paste another key",
        remove: "Remove key",
        save: "Save",
        cancel: "Cancel",
        keyPlaceholder: "czn_…",
        keyLabel: "API key",
        keyNote: "The key is checked with the Gateway before it is saved, then updated in every app that is on.",
        waiting: "Waiting for you to click Allow in the browser…",
        loginOk: (label) => `Signed in — key "${label}" is saved on this computer`,
        loginFail: "Could not sign in",
        saved: "New key saved",
        savedUnverified: "Key saved (not verified: the Gateway could not be reached)",
        invalidKey: "The Gateway rejected this key, so it was not saved",
        removed: "Key removed from this computer",
        modelSection: "Model",
        model: "Default model",
        modelAuto: "Automatic (first model of your plan)",
        modelLoading: "Loading models…",
        modelNote: "Changing the key or model updates every app that is on.",
        modelSaved: "Default model changed",
        linkSection: "Connection",
        gateway: "Gateway",
        manage: "Manage keys on the web",
        open: "Open",
        updated: (names) => `Updated: ${names}`,
      },
      apps: {
        title: "Apps",
        sub: "Turn an app on to use Crizon AI. Turn it off to restore your previous config.",
        needKey: "Add an API key before turning apps on.",
        addKey: "Add key",
        on: (command, newTerminal) => newTerminal ? `Using Crizon · open a new terminal and run ${command}` : `Using Crizon · run ${command}`,
        off: "Installed · off",
        notInstalled: "Not installed",
        switchLabel: (name) => `Use Crizon for ${name}`,
        turnedOn: (name, command, newTerminal) => newTerminal ? `Crizon is on for ${name} — open a new terminal and run ${command}` : `Crizon is on for ${name} — just run ${command}`,
        turnedOff: (name) => `Crizon is off for ${name}; your previous config is back`,
        backup: (path) => `Backup: ${path}`,
        conflict: (path) => `${path} already has a "crizon" provider you wrote. Remove it, then turn this on again.`,
        backupNote: "Crizon always backs up a config file before changing it (.crizon-backup-… suffix).",
      },
      check: {
        title: "Connection check",
        sub: "Try your key with the Gateway and check that it supports the API format each app uses.",
        run: "Check now",
        gateway: "Gateway & API key",
        gatewayOk: (count) => `Connected · ${count} models in your plan`,
        gatewayErr: (code) => code === "no_key" ? "No API key yet" : code === "network_error" ? "Cannot reach the Gateway" : `Gateway error: ${code}`,
        ok: "OK",
        fail: "Error",
        supported: "Supported",
        unsupported: "Not supported",
        unreachable: "Unreachable",
      },
      mcp: {
        title: "MCP",
        sub: "MCP servers give AI apps extra tools: files, GitHub, the browser… Turn each one on or off per app.",
        add: "Add MCP",
        search: "Search MCP",
        count: (n) => `${n} server${n === 1 ? "" : "s"}`,
        empty: "No MCP servers on this computer yet.",
        noMatch: "No MCP server matches.",
        appsTitle: "Apps",
        states: { on: "On", off: "Off", absent: "Not added — turn on to copy it over", unsupported: "This app cannot run this kind of server", missing: "App not installed", error: "Cannot read the config file" },
        kinds: { stdio: "Runs on this computer (stdio)", http: "Remote (HTTP)", sse: "Remote (SSE)", unknown: "Unknown" },
        kind: "Type",
        command: "Command",
        url: "URL",
        envKeys: "Environment variables",
        headerKeys: "Headers",
        secretsNote: "Environment and header values stay on this computer; this page never shows them.",
        restart: "Reopen the app (or start a new chat) to apply the change.",
        switchLabel: (name, app) => `Turn on ${name} for ${app}`,
        turnedOn: (name, app) => `${name} is on for ${app}`,
        turnedOff: (name, app) => `${name} is off for ${app}`,
        removeAll: "Remove from all apps",
        confirmRemove: "Click again to remove",
        removed: (name) => `${name} removed`,
        form: {
          title: "Add an MCP server",
          name: "Name",
          namePh: "e.g. github",
          type: "Type",
          command: "Command",
          args: "Arguments — one per line",
          env: "Environment variables — one KEY=value per line",
          url: "URL",
          headers: "Headers — one Name: value per line",
          apps: "Install in",
          next: "Review",
          back: "Edit",
          confirm: "Install",
          review: "Crizon will write exactly this config (secret values hidden):",
          files: "Into these files:",
          unpinned: "The package has no pinned version (e.g. @1.2.3) — a new release could change its behaviour.",
          added: (name) => `${name} added`,
        },
        errors: {
          exists: "An MCP server with this name already exists.",
          invalid_name: "Use letters, digits, - and _ only (up to 64 characters).",
          invalid_def: "The server details are not valid.",
          unsupported_kind: "One of the apps cannot run this kind of server.",
          app_missing: "That app is not installed on this computer.",
          config_unreadable: "Cannot read the app's config file (invalid JSON?). Crizon will not overwrite it.",
          not_found: "Server not found.",
          no_apps: "Pick at least one app.",
        },
      },
      skills: {
        title: "Skills",
        sub: "Skills are instructions and scripts that help agents with specialist work (PDF, Excel, design…). Turn each one on or off for Claude Code and Codex.",
        install: "Install from GitHub",
        search: "Search skills",
        count: (n) => `${n} skill${n === 1 ? "" : "s"}`,
        empty: "No skills on this computer yet.",
        noMatch: "No skill matches.",
        appsTitle: "Apps",
        states: { on: "On", off: "Off", absent: "Not added — turn on to copy it over", missing: "App not installed" },
        folder: "Folder",
        restart: "Start a new session in the app to see the change.",
        switchLabel: (name, app) => `Turn on ${name} for ${app}`,
        turnedOn: (name, app) => `${name} is on for ${app}`,
        turnedOff: (name, app) => `${name} is off for ${app}`,
        removeAll: "Remove from all apps",
        confirmRemove: "Click again to remove",
        removed: (name) => `${name} moved to the Crizon trash`,
        trashNote: "Removing moves the skill to ~/.crizon-ai/trash, so you can get it back.",
        gh: {
          title: "Install a skill from GitHub",
          url: "GitHub link to the skill folder",
          urlPh: "https://github.com/anthropics/skills/tree/main/skills/pdf",
          next: "Review",
          loading: "Reading from GitHub…",
          source: "Source",
          pinned: "Pinned to commit",
          files: (n, size) => `${n} file${n === 1 ? "" : "s"} · ${size}`,
          apps: "Install in",
          back: "Change link",
          confirm: "Install",
          note: "Only install skills you trust: a skill can include scripts the agent will run on your computer.",
          installed: (name) => `${name} installed`,
        },
        errors: {
          invalid_url: "Use a link like https://github.com/<owner>/<repo>/tree/<branch>/<folder>.",
          github_not_found: "Repo, branch or folder not found on GitHub.",
          github_rate_limited: "GitHub is rate limiting requests. Try again in a few minutes.",
          github_error: "GitHub returned an error. Try again later.",
          no_skill_md: "This folder has no SKILL.md, so it is not a skill.",
          too_large: "The skill is too large (up to 100 files, 2 MB).",
          exists: "A skill with this folder name already exists.",
          invalid_name: "The skill folder name is not valid.",
          app_missing: "That app is not installed on this computer.",
          not_found: "Skill not found.",
          no_apps: "Pick at least one app.",
        },
      },
      rank: {
        title: "Leaderboard",
        sub: "Popular MCP servers and skills, refreshed daily from the MCP Registry and GitHub. Tap one to see what it does and install it.",
        tabs: { featured: "Recommended", hot: "Trending" },
        kinds: { "": "All", MCP: "MCP", SKILL: "Skills" },
        search: "Search the catalog",
        hotNote: "Trending is picked automatically from GitHub star growth and is not reviewed by Crizon — check before installing.",
        featuredEmpty: "No recommendations yet. Have a look at Trending.",
        empty: "Nothing matches.",
        unreachable: "Could not load the catalog — check your connection and try again.",
        retry: "Try again",
        perWeek: (n) => `+${n}/week`,
        verified: "Reviewed by Crizon",
        unverified: "Not reviewed",
        installedIn: (names) => `Installed in ${names}`,
        kind: "Type",
        kindMcp: (runtime) => `MCP server${runtime ? ` · ${runtime}` : ""}`,
        kindSkill: "Skill",
        version: "Pinned version",
        stars: "GitHub stars",
        week: "Last 7 days",
        source: "Source",
        original: "Original description",
        howTo: "Crizon will install it with",
        values: "Settings to fill in",
        required: "required",
        optional: "optional",
        secretNote: "What you type is only written to app configs on this computer, never sent to Crizon.",
        apps: "Install in",
        install: "Install",
        manage: "Manage",
        installed: (name) => `${name} installed`,
        unverifiedWarn: "Crizon has not reviewed this item. MCP servers and skills run commands on your computer — only install sources you trust.",
        dockerNote: "Needs Docker running on this computer.",
        about: "About",
        what: "What it does",
        features: "Key features",
        when: "When to use it",
        needs: "What you need",
        readme: "From the repo",
        skillDoc: "Skill instructions",
        readMore: "Show everything",
        images: "Images",
        license: "License",
        homepage: "Homepage",
        loadingDetail: "Loading details from the repo…",
        noDetail: "This repo has no description yet.",
        errors: { missing_value: (name) => `Please fill in ${name}.`, catalog_unreachable: "Could not reach the Crizon catalog.", catalog_not_found: "This item is no longer in the catalog.", unsupported_install: "This item cannot be installed automatically yet." },
      },
    },
  };

  const ICON = {
    key: '<circle cx="7.5" cy="15.5" r="5"/><path d="M11 12l9.5-9.5M16 7l3 3M18.5 4.5l2 2"/>',
    apps: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',
    check: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
    mcp: '<path d="M9 2.5v5M15 2.5v5M6.5 7.5h11v3.5a5.5 5.5 0 0 1-11 0zM12 16.5v5"/>',
    rank: '<path d="M8 21h8M12 16.5V21M7 3.5h10V9a5 5 0 0 1-10 0zM17 5h3v1.5A3.5 3.5 0 0 1 17 10M7 5H4v1.5A3.5 3.5 0 0 0 7 10"/>',
    tui: '<path d="M12 3.5l1.9 5.2 5.2 1.9-5.2 1.9L12 17.7l-1.9-5.2-5.2-1.9 5.2-1.9z"/>',
    skill: '<path d="M5 5.5a2 2 0 0 1 2-2h11v14H7a2 2 0 0 0-2 2z"/><path d="M5 19.5a2 2 0 0 0 2 2h11v-4"/>',
    warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.5v.01"/>',
    ok: '<path d="M6 12.5l4 4 8-9"/>',
    x: '<path d="M7 7l10 10M17 7L7 17"/>',
  };

  const ICON_OK = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON.ok}</svg>`;

  const NAV = [["account", "key"], ["apps", "apps"], ["check", "check"], null, ["mcp", "mcp"], ["skills", "skill"], ["rank", "rank"]];

  let L = COPY.vi;
  let token = "";
  let state = null;
  let view = "apps";
  let models = null;
  let check = null;
  let keyForm = false;
  let lastLogin = null;
  let pollTimer = null;
  let mcp = null;
  let skills = null;
  let sheet = null;
  const catalog = { tab: "featured", kind: "", q: "", items: [], loading: false, error: null, seq: 0 };
  const search = { mcp: "", skills: "" };
  const busy = new Set();

  const $ = (selector) => document.querySelector(selector);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const icon = (name, size = "", tone = name) => `<span class="app-icon app-icon--${tone}${size ? ` app-icon--${size}` : ""}" aria-hidden="true"><svg viewBox="0 0 24 24">${ICON[name]}</svg></span>`;
  // Real marks (Simple Icons, brands.js) on the maker's colour; Aider ships its own app icon.
  const APP_BRAND = { claude: "claude", "claude-desktop": "claude", codex: "openai", qwen: "qwen", cursor: "cursor", gemini: "googlegemini" };
  const appIcon = (id, size = "") => {
    const sized = size ? ` app-icon--${size}` : "";
    if (id === "aider") return `<img class="app-icon app-icon--img${sized}" src="/aider.png" alt="" aria-hidden="true">`;
    if (id === "tui") return `<img class="app-icon app-icon--img${sized}" src="/crizon.png" alt="" aria-hidden="true">`;
    const mark = APP_BRAND[id] && (window.CRIZON_BRANDS || {})[APP_BRAND[id]];
    if (!mark) return icon(id, size);
    return `<span class="app-icon app-icon--mark mark--${APP_BRAND[id]}${sized}" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="${mark.path}"/></svg></span>`;
  };

  function readToken() {
    const match = location.hash.match(/(?:^#|&)t=([A-Za-z0-9_-]+)/);
    if (match) {
      try { sessionStorage.setItem("crizon-ui-token", match[1]); } catch { /* chế độ riêng tư */ }
      history.replaceState(null, "", "/");
      return match[1];
    }
    try { return sessionStorage.getItem("crizon-ui-token") || ""; } catch { return ""; }
  }

  async function api(method, path, body) {
    const response = await fetch(path, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || String(response.status)), { data, status: response.status });
    return data;
  }

  function toast(title, detail) {
    const el = $("#toast");
    // Bảng chi tiết nằm ở top layer: HUD phải nằm trong nó mới không bị nền mờ che.
    const host = $("#sheet")?.open ? $("#sheet") : document.body;
    if (el.parentElement !== host) host.appendChild(el);
    el.innerHTML = `${esc(title)}${detail ? `<small>${esc(detail)}</small>` : ""}`;
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { el.hidden = true; }, 4800);
  }

  function updatedNote(reapplied) {
    const names = (reapplied || []).filter((row) => row.ok).map((row) => state.apps.find((app) => app.id === row.id)?.name || row.id);
    return names.length ? L.account.updated(names.join(", ")) : "";
  }

  /* ── Vẽ giao diện ─────────────────────────────────────────────── */

  function renderNav() {
    $("#nav").innerHTML = NAV.map((item) => {
      if (!item) return '<div class="nav-sep" role="separator"></div>';
      const [id, glyph] = item;
      return `<button type="button" class="nav-item" data-nav="${id}" ${view === id ? 'aria-current="page"' : ""}>${icon(glyph, "sm")}<span>${esc(L.nav[id])}</span></button>`;
    }).join("");
  }

  function row(leading, title, sub, trailing = "") {
    return `<li class="row">${leading}<div class="row-body"><div class="row-text"><span class="row-title">${title}</span>${sub ? `<span class="row-sub">${sub}</span>` : ""}</div>${trailing}</div></li>`;
  }

  function accountPane() {
    const a = state.account;
    const pending = state.login.pending;
    const modelOptions = models === null
      ? `<option>${esc(L.account.modelLoading)}</option>`
      : [`<option value="">${esc(L.account.modelAuto)}</option>`, ...(Array.isArray(models) ? models : []).map((id) => `<option value="${esc(id)}" ${id === a.model ? "selected" : ""}>${esc(id)}</option>`)].join("");
    const manageUrl = `${a.portalUrl}${a.portalUrl.includes("?") ? "&" : "?"}view=keys`;
    return `
      <h1 class="page-title">${esc(L.account.title)}</h1>
      <p class="page-sub">${esc(L.account.sub)}</p>
      ${a.source === "env" ? `<div class="banner banner--warn">${icon("key", "sm", "rank")}<p>${esc(L.account.envNote)}</p></div>` : ""}
      ${pending ? `<div class="banner"><span class="spinner" aria-hidden="true"></span><p>${esc(L.account.waiting)}</p></div>` : ""}
      <section class="hero">
        ${icon("key", "lg", a.hasKey ? "key" : "gray")}
        <div>
          <h2>${esc(a.hasKey ? L.account.connected : L.account.noKey)}</h2>
          <p>${a.hasKey ? `<span class="mono">${esc(a.keyMasked)}</span>${a.source === "env" ? ` · ${esc(L.account.fromEnv)}` : ""}` : esc(L.account.noKeyBody)}</p>
        </div>
      </section>
      <div class="actions">
        <button type="button" class="btn btn--filled" data-action="login" ${pending ? "disabled" : ""}>${esc(L.account.browserLogin)}</button>
        <button type="button" class="btn btn--tinted" data-action="key-form">${esc(a.hasKey ? L.account.replace : L.account.paste)}</button>
        ${a.hasKey && a.source !== "env" ? `<button type="button" class="plain plain--danger" data-action="remove-key">${esc(L.account.remove)}</button>` : ""}
      </div>
      ${keyForm ? `
        <form id="key-form" class="field" autocomplete="off">
          <input id="key-input" class="input mono" type="password" spellcheck="false" placeholder="${esc(L.account.keyPlaceholder)}" aria-label="${esc(L.account.keyLabel)}" required>
          <button type="submit" class="btn btn--filled">${esc(L.account.save)}</button>
          <button type="button" class="btn btn--tinted" data-action="key-form">${esc(L.account.cancel)}</button>
        </form>
        <p class="footnote">${esc(L.account.keyNote)}</p>` : ""}
      <h2 class="section-title">${esc(L.account.modelSection)}</h2>
      <ul class="group">
        ${row(icon("tui"), esc(L.account.model), "", `<select id="model-select" class="select" aria-label="${esc(L.account.model)}" ${a.hasKey && models !== null ? "" : "disabled"}>${modelOptions}</select>`)}
      </ul>
      <p class="footnote">${esc(L.account.modelNote)}</p>
      <h2 class="section-title">${esc(L.account.linkSection)}</h2>
      <ul class="group">
        ${row(icon("check"), esc(L.account.gateway), "", `<span class="row-value mono">${esc(a.baseUrl)}</span>`)}
        ${row(icon("key", "", "codex"), esc(L.account.manage), "", `<a class="plain" href="${esc(manageUrl)}" target="_blank" rel="noopener noreferrer">${esc(L.account.open)} ↗</a>`)}
      </ul>`;
  }

  function appsPane() {
    const hasKey = state.account.hasKey;
    const rows = state.apps.map((app) => {
      let sub;
      if (app.connected) sub = esc(L.apps.on(app.command, app.newTerminal));
      else if (!app.installed) sub = `${esc(L.apps.notInstalled)} · <code>${esc(app.installHint)}</code><button type="button" class="copy" data-copy="${esc(app.installHint)}">${esc(L.copy)}</button>`;
      else sub = esc(L.apps.off);
      const control = busy.has(app.id)
        ? '<span class="spinner" aria-hidden="true"></span>'
        : `<button type="button" class="switch" role="switch" aria-checked="${app.connected}" aria-label="${esc(L.apps.switchLabel(app.name))}" data-app="${app.id}" ${hasKey || app.connected ? "" : "disabled"}></button>`;
      return row(appIcon(app.id), esc(app.name), sub, control);
    }).join("");
    return `
      <h1 class="page-title">${esc(L.apps.title)}</h1>
      <p class="page-sub">${esc(L.apps.sub)}</p>
      ${hasKey ? "" : `<div class="banner banner--warn">${icon("key", "sm", "rank")}<p>${esc(L.apps.needKey)}</p><button type="button" class="btn btn--filled btn--sm" data-nav="account">${esc(L.apps.addKey)}</button></div>`}
      <ul class="group">${rows}</ul>
      <p class="footnote">${esc(L.apps.backupNote)}</p>`;
  }

  function checkPane() {
    const running = busy.has("check");
    let results = "";
    if (check) {
      const g = check.gateway;
      const pill = (ok, text) => `<span class="pill ${ok ? "pill--ok" : "pill--err"}">${esc(text)}</span>`;
      results = `<ul class="group">${row(icon(g.ok ? "ok" : "x", "", g.ok ? "check" : "red"), esc(L.check.gateway), esc(g.ok ? L.check.gatewayOk(g.count) : L.check.gatewayErr(g.error)), pill(g.ok, g.ok ? L.check.ok : L.check.fail))}
        ${state.apps.filter((app) => check.apps[app.id]).map((app) => {
          const result = check.apps[app.id];
          const text = result.supported ? L.check.supported : result.status === 0 ? L.check.unreachable : L.check.unsupported;
          return row(appIcon(app.id), esc(app.name), `<code>${esc(result.path)}</code>`, pill(result.supported, text));
        }).join("")}</ul>`;
    }
    return `
      <h1 class="page-title">${esc(L.check.title)}</h1>
      <p class="page-sub">${esc(L.check.sub)}</p>
      <div class="actions actions--top"><button type="button" class="btn btn--filled" data-action="check" ${running ? "disabled" : ""}>${running ? '<span class="spinner" aria-hidden="true"></span>' : ""}${esc(L.check.run)}</button></div>
      ${results}`;
  }

  /* ── MCP + skill ─────────────────────────────────────────────── */

  const errorText = (copy, error) => copy.errors[error?.data?.error] || error?.data?.error || error?.message;
  const summaryLine = (summary) => (summary.kind === "stdio" ? [summary.command, ...summary.args].join(" ") : summary.url || "");
  const bytes = (size) => (size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`);
  const chevron = '<span class="chevron" aria-hidden="true">›</span>';

  /** Danh sách có ô tìm (vẽ lại riêng #list khi gõ để không mất focus). */
  function libraryPane(kind) {
    const copy = L[kind];
    const action = kind === "mcp" ? ["mcp-add", copy.add] : ["skill-gh", copy.install];
    return `
      <h1 class="page-title">${esc(copy.title)}</h1>
      <p class="page-sub">${esc(copy.sub)}</p>
      <div class="toolbar">
        <input class="input search" type="search" data-search="${kind}" value="${esc(search[kind])}" placeholder="${esc(copy.search)}" aria-label="${esc(copy.search)}">
        <button type="button" class="btn btn--filled" data-action="${action[0]}">${esc(action[1])}</button>
      </div>
      <div id="list">${listHtml(kind)}</div>`;
  }

  function listHtml(kind) {
    const data = kind === "mcp" ? mcp : skills;
    const copy = L[kind];
    if (!data) return `<div class="banner"><span class="spinner" aria-hidden="true"></span><p>${esc(L.loading)}</p></div>`;
    const items = kind === "mcp" ? data.servers : data.skills;
    if (!items.length) return `<div class="empty">${icon(kind === "mcp" ? "mcp" : "skill", "lg")}<p>${esc(copy.empty)}</p></div>`;
    const query = search[kind].trim().toLowerCase();
    const text = (item) => (kind === "mcp" ? `${item.name} ${summaryLine(item.summary)}` : `${item.dir} ${item.name} ${item.description}`).toLowerCase();
    const shown = items.filter((item) => !query || text(item).includes(query));
    if (!shown.length) return `<p class="footnote">${esc(copy.noMatch)}</p>`;
    const rows = shown.map((item) => {
      const on = data.apps.filter((app) => item.apps[app.id] === "on").map((app) => appIcon(app.id, "xs")).join("");
      const id = kind === "mcp" ? item.name : item.dir;
      const sub = kind === "mcp"
        ? `<span class="row-sub row-sub--mono">${esc(summaryLine(item.summary))}</span>`
        : `<span class="row-sub row-sub--clamp">${esc(item.description)}</span>`;
      return `<li class="row row--link"><button type="button" class="row-button" data-open="${kind}" data-id="${esc(id)}">${icon(kind === "mcp" ? "mcp" : "skill")}<div class="row-body"><div class="row-text"><span class="row-title">${esc(item.name)}</span>${sub}</div><span class="badges">${on}</span>${chevron}</div></button></li>`;
    }).join("");
    return `<p class="list-count">${esc(copy.count(shown.length))}</p><ul class="group">${rows}</ul>`;
  }

  function appSwitches(kind, item, apps) {
    const copy = L[kind];
    return apps.map((app) => {
      const status = item.apps[app.id];
      const key = `${kind}:${kind === "mcp" ? item.name : item.dir}:${app.id}`;
      const control = busy.has(key)
        ? '<span class="spinner" aria-hidden="true"></span>'
        : `<button type="button" class="switch" role="switch" aria-checked="${status === "on"}" aria-label="${esc(copy.switchLabel(item.name, app.name))}" data-toggle="${kind}" data-app-id="${app.id}" ${["on", "off", "absent"].includes(status) ? "" : "disabled"}></button>`;
      return row(appIcon(app.id), esc(app.name), esc(copy.states[status] || status), control);
    }).join("");
  }

  function removeButton(copy) {
    return `<div class="actions"><button type="button" class="btn btn--danger" data-action="remove-item">${esc(sheet.confirm ? copy.confirmRemove : copy.removeAll)}</button></div>`;
  }

  function mcpSheet() {
    const server = mcp?.servers.find((item) => item.name === sheet.id);
    if (!server) return null;
    const c = L.mcp;
    const s = server.summary;
    const info = [row(icon("mcp"), esc(c.kind), "", `<span class="row-value">${esc(c.kinds[s.kind] || s.kind)}</span>`)];
    if (s.kind === "stdio") info.push(`<li class="code-row"><span class="code-label">${esc(c.command)}</span><code>${esc(summaryLine(s))}</code></li>`);
    else if (s.url) info.push(`<li class="code-row"><span class="code-label">${esc(c.url)}</span><code>${esc(s.url)}</code></li>`);
    const keys = s.kind === "stdio" ? s.envKeys : s.headerKeys;
    if (keys?.length) info.push(`<li class="code-row"><span class="code-label">${esc(s.kind === "stdio" ? c.envKeys : c.headerKeys)}</span><code>${keys.map(esc).join(", ")}</code></li>`);
    return {
      title: server.name,
      body: `
        <ul class="group">${info.join("")}</ul>
        ${keys?.length ? `<p class="footnote">${esc(c.secretsNote)}</p>` : ""}
        <h3 class="section-title">${esc(c.appsTitle)}</h3>
        <ul class="group">${appSwitches("mcp", server, mcp.apps)}</ul>
        <p class="footnote">${esc(c.restart)}</p>
        ${removeButton(c)}`,
    };
  }

  function skillSheet() {
    const skill = skills?.skills.find((item) => item.dir === sheet.id);
    if (!skill) return null;
    const c = L.skills;
    return {
      title: skill.name,
      body: `
        ${skill.description ? `<p class="sheet-lead">${esc(skill.description)}</p>` : ""}
        <ul class="group"><li class="code-row"><span class="code-label">${esc(c.folder)}</span><code>${esc(skill.dir)}</code></li></ul>
        <h3 class="section-title">${esc(c.appsTitle)}</h3>
        <ul class="group">${appSwitches("skills", skill, skills.apps)}</ul>
        <p class="footnote">${esc(c.restart)}</p>
        ${removeButton(c)}
        <p class="footnote">${esc(c.trashNote)}</p>`,
    };
  }

  const appChecks = (apps, kinds, chosen) => `<ul class="group">${apps.filter((app) => app.present && !app.error).map((app) => {
    const usable = !kinds || kinds.includes(app.id);
    return `<li class="row"><label class="check-row">${appIcon(app.id)}<span class="row-body"><span class="row-text"><span class="row-title">${esc(app.name)}</span></span><input type="checkbox" data-pick="${app.id}" ${chosen.includes(app.id) && usable ? "checked" : ""} ${usable ? "" : "disabled"}></span></label></li>`;
  }).join("")}</ul>`;

  /** Bản nháp form thêm MCP → định nghĩa gửi lên server. */
  function draftDef(draft) {
    const lines = (text) => String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const pairs = (text, separator) => Object.fromEntries(lines(text).map((line) => {
      const at = line.indexOf(separator);
      return at > 0 ? [line.slice(0, at).trim(), line.slice(at + 1).trim()] : [line, ""];
    }));
    if (draft.type === "stdio") return { type: "stdio", command: String(draft.command || "").trim(), args: lines(draft.args), env: pairs(draft.env, "=") };
    return { type: draft.type, url: String(draft.url || "").trim(), headers: pairs(draft.headers, ":") };
  }

  function unpinned(def) {
    if (def.type !== "stdio" || !/^(npx|uvx|bunx|pnpx)(\.cmd)?$/i.test(def.command)) return false;
    const pkg = def.args.find((arg) => !arg.startsWith("-"));
    return Boolean(pkg) && !/.@\d|==\d/.test(pkg);
  }

  function mcpAddSheet() {
    const c = L.mcp.form;
    const d = sheet.draft;
    const kindsFor = (type) => mcp.apps.filter((app) => (type === "stdio" ? true : type === "http" ? app.id !== "claude-desktop" : !["claude-desktop", "codex"].includes(app.id))).map((app) => app.id);
    if (sheet.step === "review") {
      const def = draftDef(d);
      const masked = def.type === "stdio"
        ? { command: def.command, args: def.args, ...(Object.keys(def.env).length ? { env: Object.fromEntries(Object.keys(def.env).map((key) => [key, "••••"])) } : {}) }
        : { type: def.type, url: def.url, ...(Object.keys(def.headers).length ? { headers: Object.fromEntries(Object.keys(def.headers).map((key) => [key, "••••"])) } : {}) };
      const files = mcp.apps.filter((app) => d.apps.includes(app.id));
      return {
        title: c.title,
        body: `
          <p class="sheet-lead">${esc(c.review)}</p>
          <pre class="code-block">${esc(JSON.stringify({ [d.name]: masked }, null, 2))}</pre>
          ${unpinned(def) ? `<div class="banner banner--warn">${icon("warn", "sm", "rank")}<p>${esc(c.unpinned)}</p></div>` : ""}
          <p class="sheet-lead">${esc(c.files)}</p>
          <ul class="group">${files.map((app) => row(appIcon(app.id), esc(app.name), `<code>${esc(app.path)}</code>`)).join("")}</ul>
          <div class="actions">
            <button type="button" class="btn btn--filled" data-action="mcp-install" ${busy.has("mcp-add") ? "disabled" : ""}>${busy.has("mcp-add") ? '<span class="spinner" aria-hidden="true"></span>' : ""}${esc(c.confirm)}</button>
            <button type="button" class="btn btn--tinted" data-action="mcp-back">${esc(c.back)}</button>
          </div>`,
      };
    }
    const field = (name, label, control) => `<label class="form-label" for="f-${name}">${esc(label)}</label>${control}`;
    const input = (name, placeholder = "") => `<input id="f-${name}" class="input input--block${name === "name" ? "" : " mono"}" data-field="${name}" value="${esc(d[name] || "")}" placeholder="${esc(placeholder)}" spellcheck="false" autocomplete="off">`;
    const area = (name, placeholder = "") => `<textarea id="f-${name}" class="textarea mono" data-field="${name}" placeholder="${esc(placeholder)}" spellcheck="false" autocomplete="off">${esc(d[name] || "")}</textarea>`;
    const typeSelect = `<select id="f-type" class="select select--block" data-field="type">${["stdio", "http", "sse"].map((type) => `<option value="${type}" ${d.type === type ? "selected" : ""}>${esc(L.mcp.kinds[type])}</option>`).join("")}</select>`;
    return {
      title: c.title,
      body: `
        <form id="mcp-form" autocomplete="off">
          ${field("name", c.name, input("name", c.namePh))}
          ${field("type", c.type, typeSelect)}
          ${d.type === "stdio"
            ? `${field("command", c.command, input("command", "npx"))}${field("args", c.args, area("args", "-y\n@modelcontextprotocol/server-github@2025.4.8"))}${field("env", c.env, area("env", "GITHUB_PERSONAL_ACCESS_TOKEN=…"))}`
            : `${field("url", c.url, input("url", "https://example.com/mcp"))}${field("headers", c.headers, area("headers", "Authorization: Bearer …"))}`}
          <p class="form-label">${esc(c.apps)}</p>
          ${appChecks(mcp.apps, kindsFor(d.type), d.apps)}
          <div class="actions"><button type="submit" class="btn btn--filled">${esc(c.next)}</button></div>
        </form>`,
    };
  }

  function skillGhSheet() {
    const c = L.skills.gh;
    const p = sheet.preview;
    const loading = busy.has("skill-gh");
    if (!p) {
      return {
        title: c.title,
        body: `
          <form id="skill-gh-form" autocomplete="off">
            <label class="form-label" for="f-gh-url">${esc(c.url)}</label>
            <input id="f-gh-url" class="input input--block mono" data-field="url" value="${esc(sheet.draft.url || "")}" placeholder="${esc(c.urlPh)}" spellcheck="false" type="url" required>
            <div class="actions"><button type="submit" class="btn btn--filled" ${loading ? "disabled" : ""}>${loading ? '<span class="spinner" aria-hidden="true"></span>' : ""}${esc(loading ? c.loading : c.next)}</button></div>
          </form>
          <p class="footnote">${esc(c.note)}</p>`,
      };
    }
    const total = p.files.reduce((sum, file) => sum + file.size, 0);
    const source = `github.com/${p.source.owner}/${p.source.repo}/${p.source.path}`;
    return {
      title: p.name,
      body: `
        ${p.description ? `<p class="sheet-lead">${esc(p.description)}</p>` : ""}
        <ul class="group">
          <li class="code-row"><span class="code-label">${esc(c.source)}</span><code>${esc(source)}</code></li>
          <li class="code-row"><span class="code-label">${esc(c.pinned)}</span><code>${esc(p.source.sha)}</code></li>
          <li class="code-row"><details${p.files.length <= 8 ? " open" : ""}><summary class="code-label">${esc(c.files(p.files.length, bytes(total)))}</summary><code>${p.files.map((file) => esc(file.path)).join("<br>")}</code></details></li>
        </ul>
        <p class="form-label">${esc(c.apps)}</p>
        ${appChecks(skills.apps, null, sheet.draft.apps)}
        <div class="banner banner--warn">${icon("warn", "sm", "rank")}<p>${esc(c.note)}</p></div>
        <div class="actions">
          <button type="button" class="btn btn--filled" data-action="skill-install" ${loading ? "disabled" : ""}>${loading ? '<span class="spinner" aria-hidden="true"></span>' : ""}${esc(c.confirm)}</button>
          <button type="button" class="btn btn--tinted" data-action="skill-back">${esc(c.back)}</button>
        </div>`,
    };
  }

  function renderSheet() {
    const dialog = $("#sheet");
    if (!sheet) {
      if (dialog.open) dialog.close();
      delete dialog.dataset.screen;
      document.body.appendChild($("#toast"));
      return;
    }
    const content = sheet.type === "mcp" ? mcpSheet() : sheet.type === "skills" ? skillSheet() : sheet.type === "mcp-add" ? mcpAddSheet() : sheet.type === "catalog" ? catalogSheet() : skillGhSheet();
    if (!content) {
      sheet = null;
      if (dialog.open) dialog.close();
      document.body.appendChild($("#toast"));
      return;
    }
    const screen = `${sheet.type}:${sheet.id || ""}:${sheet.step || ""}:${sheet.preview ? 1 : 0}`;
    const fresh = dialog.dataset.screen !== screen;
    dialog.dataset.screen = screen;
    // Nội dung vẽ vào khung riêng: HUD (#toast) có thể đang nằm trong dialog, không được xoá nó.
    let box = dialog.querySelector(".sheet-box");
    if (!box) {
      box = document.createElement("div");
      box.className = "sheet-box";
      dialog.prepend(box);
    }
    box.innerHTML = `<header class="sheet-head"><h2 id="sheet-title">${esc(content.title)}</h2><button type="button" class="plain" data-action="sheet-close">${esc(L.close)}</button></header><div class="sheet-body">${content.body}</div>`;
    if (!dialog.open) dialog.showModal();
    if (fresh) dialog.scrollTop = 0;
  }

  /* ── Bảng xếp hạng (kho MCP/Skill từ Crizon) ─────────────────── */

  const compact = (n) => new Intl.NumberFormat(state?.lang === "en" ? "en" : "vi", { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);
  const installLine = (item) => {
    const i = item.install || {};
    if (item.kind === "SKILL") return `${i.owner}/${i.repo}/${i.path} @ ${String(i.sha || "").slice(0, 7)}`;
    return i.type === "stdio" ? [i.command, ...(i.args || [])].join(" ") : i.url || "";
  };
  const catalogVars = (item) => (item.kind === "MCP" ? (item.install?.type === "stdio" ? item.install.env : item.install?.headers) || [] : []);
  const itemIcon = (item, size = "") => {
    const glyph = icon(item.kind === "MCP" ? "mcp" : "skill", size);
    if (!item.avatar) return glyph;
    // Ảnh lỗi (alt rỗng) thì trình duyệt ẩn ảnh, icon chung bên dưới vẫn hiện.
    return glyph.replace("</span>", `<img class="avatar" src="${esc(item.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>`).replace('class="app-icon', 'class="app-icon app-icon--avatar');
  };
  const docBlocks = (blocks) => blocks.map((block) => {
    if (block.t === "h") return `<h4>${esc(block.text)}</h4>`;
    if (block.t === "li") return `<ul>${block.items.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`;
    if (block.t === "code") return `<pre>${esc(block.text)}</pre>`;
    return `<p>${esc(block.text)}</p>`;
  }).join("");

  async function loadCatalogItem(id) {
    try {
      const detail = await api("GET", `/api/catalog/item?id=${encodeURIComponent(id)}`);
      const item = catalog.items.find((row) => row.id === id);
      if (item) Object.assign(item, detail, { detailLoaded: true });
    } catch {
      const item = catalog.items.find((row) => row.id === id);
      if (item) item.detailLoaded = true;
    }
    if (sheet?.type === "catalog" && sheet.id === id) renderSheet();
  }

  const appName = (id) => (mcp?.apps || skills?.apps || []).find((app) => app.id === id)?.name || id;

  async function loadCatalog() {
    catalog.loading = true;
    catalog.error = null;
    $("#list") && ($("#list").innerHTML = catalogList());
    const seq = (catalog.seq = (catalog.seq || 0) + 1);
    try {
      const params = new URLSearchParams({ tab: catalog.tab, kind: catalog.kind, q: catalog.q });
      const data = await api("GET", `/api/catalog?${params}`);
      if (seq !== catalog.seq) return;
      catalog.items = data.items;
    } catch (error) {
      if (seq !== catalog.seq) return;
      catalog.items = [];
      catalog.error = error?.data?.error || error?.message;
    }
    catalog.loading = false;
    render();
  }

  function rankPane() {
    const c = L.rank;
    const seg = ["featured", "hot"].map((tab) => `<button type="button" class="seg-item" role="tab" aria-selected="${catalog.tab === tab}" data-rank-tab="${tab}">${esc(c.tabs[tab])}</button>`).join("");
    const chips = ["", "MCP", "SKILL"].map((kind) => `<button type="button" class="chip" aria-pressed="${catalog.kind === kind}" data-rank-kind="${kind}">${esc(c.kinds[kind])}</button>`).join("");
    return `
      <h1 class="page-title">${esc(c.title)}</h1>
      <p class="page-sub">${esc(c.sub)}</p>
      <div class="seg" role="tablist">${seg}</div>
      <div class="toolbar toolbar--rank">
        <input class="input search" type="search" data-search="rank" value="${esc(catalog.q)}" placeholder="${esc(c.search)}" aria-label="${esc(c.search)}">
        <div class="chips">${chips}</div>
      </div>
      ${catalog.tab === "hot" ? `<div class="banner banner--warn">${icon("warn", "sm", "rank")}<p>${esc(c.hotNote)}</p></div>` : ""}
      <div id="list">${catalogList()}</div>`;
  }

  function catalogList() {
    const c = L.rank;
    if (catalog.loading && !catalog.items.length) return `<div class="banner"><span class="spinner" aria-hidden="true"></span><p>${esc(L.loading)}</p></div>`;
    if (catalog.error) return `<div class="empty">${icon("x", "lg", "red")}<p>${esc(c.errors[catalog.error] || c.unreachable)}</p><button type="button" class="btn btn--tinted" data-action="rank-retry">${esc(c.retry)}</button></div>`;
    if (!catalog.items.length) return `<div class="empty">${icon("rank", "lg")}<p>${esc(catalog.tab === "featured" && !catalog.q ? c.featuredEmpty : c.empty)}</p></div>`;
    const rows = catalog.items.map((item, index) => {
      const growth = item.starsWeek > 0 ? `<span class="pill pill--ok">${esc(c.perWeek(compact(item.starsWeek)))}</span>` : "";
      const done = item.installedIn?.length ? `<span class="done" aria-label="${esc(c.installedIn(item.installedIn.map(appName).join(", ")))}">${ICON_OK}</span>` : "";
      return `<li class="row row--link"><button type="button" class="row-button" data-open="catalog" data-id="${esc(item.id)}"><span class="rank-no">${index + 1}</span>${itemIcon(item)}<div class="row-body"><div class="row-text"><span class="row-title">${esc(item.title)}${item.verified ? "" : ` <span class="pill pill--neutral pill--xs">${esc(c.unverified)}</span>`}</span><span class="row-sub row-sub--clamp">${esc(item.summary)}</span></div><span class="rank-meta"><span class="stars">★ ${esc(compact(item.stars))}</span>${growth}</span>${done}${chevron}</div></button></li>`;
    }).join("");
    return `<ul class="group">${rows}</ul>`;
  }

  function catalogSheet() {
    const item = catalog.items.find((row) => row.id === sheet.id);
    if (!item) return null;
    const c = L.rank;
    const d = sheet.draft;
    const isMcp = item.kind === "MCP";
    const lib = isMcp ? mcp : skills;
    const vars = catalogVars(item);
    const type = item.install?.type;
    const kinds = isMcp && lib ? lib.apps.filter((app) => (type === "stdio" ? true : type === "http" ? app.id !== "claude-desktop" : !["claude-desktop", "codex"].includes(app.id))).map((app) => app.id) : null;
    const stats = [
      [c.kind, isMcp ? c.kindMcp(item.install?.runtime || (type === "stdio" ? "" : type?.toUpperCase())) : c.kindSkill],
      [c.version, item.version || "—"],
      [c.stars, `★ ${compact(item.stars)}`],
      ...(item.starsWeek > 0 ? [[c.week, `+${compact(item.starsWeek)}`]] : []),
      [c.source, item.repo || "—"],
    ].map(([label, value]) => `<li class="kv-row"><span>${esc(label)}</span><span class="row-value">${esc(value)}</span></li>`).join("");
    const form = vars.map((row) => `
      <label class="form-label" for="v-${esc(row.name)}">${esc(row.name)} <span class="muted">· ${esc(row.required ? c.required : c.optional)}</span></label>
      <input id="v-${esc(row.name)}" class="input input--block mono" data-value="${esc(row.name)}" type="${row.secret ? "password" : "text"}" value="${esc(d.values[row.name] ?? row.default ?? "")}" spellcheck="false" autocomplete="off">
      ${row.description ? `<p class="field-hint">${esc(row.description)}</p>` : ""}`).join("");
    const busyInstall = busy.has("catalog-install");
    const vi = item.detailVi;
    const blocks = item.detail?.blocks || [];
    const doc = blocks.length
      ? `<div class="doc">${docBlocks(blocks.slice(0, 8))}${blocks.length > 8 ? `<details class="doc-more"><summary>${esc(c.readMore)}</summary>${docBlocks(blocks.slice(8))}</details>` : ""}</div>`
      : "";
    const about = !item.detailLoaded
      ? `<div class="banner"><span class="spinner" aria-hidden="true"></span><p>${esc(c.loadingDetail)}</p></div>`
      : vi
        ? `<div class="doc doc--vi"><h4>${esc(c.what)}</h4><p>${esc(vi.what)}</p>${vi.features.length ? `<h4>${esc(c.features)}</h4><ul>${vi.features.map((row) => `<li>${esc(row)}</li>`).join("")}</ul>` : ""}${vi.when ? `<h4>${esc(c.when)}</h4><p>${esc(vi.when)}</p>` : ""}${vi.needs.length ? `<h4>${esc(c.needs)}</h4><ul>${vi.needs.map((row) => `<li>${esc(row)}</li>`).join("")}</ul>` : ""}</div>
           ${doc ? `<details class="original"><summary>${esc(isMcp ? c.readme : c.skillDoc)}</summary>${doc}</details>` : ""}`
        : doc || `<p class="footnote">${esc(c.noDetail)}</p>`;
    const images = (item.detail?.images || []).filter((src) => src !== item.ogImage);
    const facts = [
      ...(item.license ? [[c.license, item.license]] : []),
      ...(item.homepage ? [[c.homepage, item.homepage.replace(/^https?:\/\//, "").replace(/\/$/, "")]] : []),
    ].map(([label, value]) => `<li class="kv-row"><span>${esc(label)}</span><span class="row-value">${esc(value)}</span></li>`).join("");
    return {
      title: item.title,
      body: `
        ${item.ogImage ? `<img class="sheet-cover" src="${esc(item.ogImage)}" alt="" referrerpolicy="no-referrer">` : ""}
        <p class="sheet-badges">${item.verified ? `<span class="pill pill--ok">${esc(c.verified)}</span>` : `<span class="pill pill--warn">${esc(c.unverified)}</span>`}${item.installedIn?.length ? ` <span class="pill pill--neutral">${esc(c.installedIn(item.installedIn.map(appName).join(", ")))}</span>` : ""}</p>
        <p class="sheet-lead sheet-lead--strong">${esc(item.summary)}</p>
        ${item.summaryVi && item.description && item.summaryVi !== item.description ? `<details class="original"><summary>${esc(c.original)}</summary><p>${esc(item.description)}</p></details>` : ""}
        ${item.topics?.length ? `<p class="topics">${item.topics.map((topic) => `<span class="pill pill--neutral">${esc(topic)}</span>`).join("")}</p>` : ""}
        <h3 class="section-title">${esc(c.about)}</h3>
        ${about}
        ${images.length ? `<h3 class="section-title">${esc(c.images)}</h3><div class="gallery">${images.map((src) => `<img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer">`).join("")}</div>` : ""}
        <ul class="group group--spaced">${stats}${facts}</ul>
        <h3 class="section-title">${esc(c.howTo)}</h3>
        <pre class="code-block">${esc(installLine(item))}</pre>
        ${item.install?.runtime === "oci" ? `<p class="footnote">${esc(c.dockerNote)}</p>` : ""}
        ${vars.length ? `<h3 class="section-title">${esc(c.values)}</h3><div class="form-card">${form}</div><p class="footnote">${esc(c.secretNote)}</p>` : ""}
        <p class="form-label">${esc(c.apps)}</p>
        ${lib ? appChecks(lib.apps, kinds, d.apps || []) : `<div class="banner"><span class="spinner" aria-hidden="true"></span><p>${esc(L.loading)}</p></div>`}
        ${item.verified ? "" : `<div class="banner banner--warn">${icon("warn", "sm", "rank")}<p>${esc(c.unverifiedWarn)}</p></div>`}
        <div class="actions">
          <button type="button" class="btn btn--filled" data-action="catalog-install" ${busyInstall || !lib ? "disabled" : ""}>${busyInstall ? '<span class="spinner" aria-hidden="true"></span>' : ""}${esc(c.install)}</button>
          ${item.installedIn?.length ? `<button type="button" class="btn btn--tinted" data-action="catalog-manage">${esc(c.manage)}</button>` : ""}
        </div>`,
    };
  }

  async function loadLibrary(kind) {
    try {
      if (kind === "mcp") mcp = await api("GET", "/api/mcp");
      else skills = await api("GET", "/api/skills");
    } catch (error) {
      toast(L.error, error?.data?.error || error?.message);
    }
    render();
  }

  function render() {
    if (!state) return;
    L = COPY[state.lang] || COPY.vi;
    document.documentElement.lang = state.lang || "vi";
    $("#brand-sub").textContent = L.sub;
    $("#version").textContent = `v${state.version}`;
    $("#quit").textContent = L.quit;
    renderNav();
    const pane = view === "account" ? accountPane() : view === "check" ? checkPane() : view === "mcp" || view === "skills" ? libraryPane(view) : view === "rank" ? rankPane() : appsPane();
    $("#pane").innerHTML = pane;
    if (keyForm && view === "account") $("#key-input")?.focus();
    renderSheet();
  }

  /* ── Dữ liệu ─────────────────────────────────────────────────── */

  async function refresh() {
    state = await api("GET", "/api/state");
    const last = state.login.last;
    if (last && JSON.stringify(last) !== JSON.stringify(lastLogin)) {
      lastLogin = last;
      if (last.ok) {
        toast(L.account.loginOk(last.label), updatedNote(last.reapplied));
        models = null;
        loadModels();
      } else {
        toast(L.account.loginFail, last.detail || last.reason);
      }
    }
    if (state.login.pending && !pollTimer) pollTimer = setInterval(() => refresh().then(render).catch(() => {}), 2000);
    if (!state.login.pending && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function loadModels() {
    if (!state?.account.hasKey) {
      models = [];
      return;
    }
    try {
      models = (await api("GET", "/api/models")).models;
    } catch {
      models = [];
    }
    render();
  }

  async function run(task) {
    try {
      await task();
    } catch (error) {
      toast(L.error, error?.data?.error || error?.message);
    }
    render();
  }

  /* ── Sự kiện ─────────────────────────────────────────────────── */

  function toggleItem(kind, appId) {
    const data = kind === "mcp" ? mcp : skills;
    const item = kind === "mcp" ? data.servers.find((row) => row.name === sheet.id) : data.skills.find((row) => row.dir === sheet.id);
    const app = data.apps.find((row) => row.id === appId);
    const on = item.apps[appId] !== "on";
    const key = `${kind}:${sheet.id}:${appId}`;
    busy.add(key);
    render();
    run(async () => {
      try {
        const body = kind === "mcp" ? { name: sheet.id, app: appId, on } : { dir: sheet.id, app: appId, on };
        const next = await api("POST", `/api/${kind}/toggle`, body);
        if (kind === "mcp") mcp = next;
        else skills = next;
        toast((on ? L[kind].turnedOn : L[kind].turnedOff)(item.name, app.name), L[kind].restart);
      } catch (error) {
        toast(L.error, errorText(L[kind], error));
      } finally {
        busy.delete(key);
      }
    });
  }

  function removeItem() {
    if (!sheet.confirm) {
      sheet.confirm = true;
      renderSheet();
      return;
    }
    const kind = sheet.type;
    const id = sheet.id;
    run(async () => {
      try {
        const next = await api("POST", `/api/${kind}/remove`, kind === "mcp" ? { name: id } : { dir: id });
        if (kind === "mcp") mcp = next;
        else skills = next;
        sheet = null;
        toast(L[kind].removed(id));
      } catch (error) {
        toast(L.error, errorText(L[kind], error));
      }
    });
  }

  const presentApps = (data, ids) => data.apps.filter((app) => app.present && !app.error && ids.includes(app.id)).map((app) => app.id);

  document.addEventListener("click", (event) => {
    if (event.target.id === "sheet") {
      sheet = null;
      renderSheet();
      return;
    }
    const target = event.target.closest("[data-nav],[data-action],[data-app],[data-copy],[data-open],[data-toggle],[data-rank-tab],[data-rank-kind],#quit");
    if (!target) return;
    if (target.dataset.open) {
      sheet = { type: target.dataset.open, id: target.dataset.id, confirm: false };
      if (sheet.type === "catalog") {
        const item = catalog.items.find((row) => row.id === sheet.id);
        if (item && !item.detailLoaded) loadCatalogItem(item.id);
        const kind = item?.kind === "SKILL" ? "skills" : "mcp";
        const lib = kind === "mcp" ? mcp : skills;
        sheet.draft = { values: {}, apps: lib ? presentApps(lib, ["claude", "codex"]) : null, kind };
        if (!lib) loadLibrary(kind).then(() => {
          const loaded = kind === "mcp" ? mcp : skills;
          if (sheet?.type === "catalog" && sheet.draft.apps === null && loaded) {
            sheet.draft.apps = presentApps(loaded, ["claude", "codex"]);
            renderSheet();
          }
        });
      }
      renderSheet();
      return;
    }
    if (target.dataset.rankTab !== undefined || target.dataset.rankKind !== undefined) {
      if (target.dataset.rankTab !== undefined) catalog.tab = target.dataset.rankTab;
      else catalog.kind = target.dataset.rankKind;
      catalog.items = [];
      render();
      loadCatalog();
      return;
    }
    if (target.dataset.toggle) {
      toggleItem(target.dataset.toggle, target.dataset.appId);
      return;
    }
    if (target.id === "quit") {
      run(async () => {
        await api("POST", "/api/quit", {});
        document.body.innerHTML = `<div class="empty empty--closed">${appIcon("tui", "lg")}<p>${esc(L.closed)}</p></div>`;
        state = null;
      });
      return;
    }
    if (target.dataset.nav) {
      view = target.dataset.nav;
      render();
      $("#pane").focus();
      if (view === "mcp" || view === "skills") loadLibrary(view);
      if (view === "rank") loadCatalog();
      return;
    }
    if (target.dataset.copy) {
      navigator.clipboard?.writeText(target.dataset.copy).then(() => { target.textContent = L.copied; }, () => {});
      return;
    }
    if (target.dataset.app) {
      const app = state.apps.find((item) => item.id === target.dataset.app);
      busy.add(app.id);
      render();
      run(async () => {
        try {
          if (app.connected) {
            state = (await api("POST", `/api/apps/${app.id}/disconnect`, {})).state;
            toast(L.apps.turnedOff(app.name));
          } else {
            const data = await api("POST", `/api/apps/${app.id}/connect`, {});
            state = data.state;
            toast(L.apps.turnedOn(app.name, app.command, app.newTerminal), data.result?.backup ? L.apps.backup(data.result.backup) : "");
          }
        } catch (error) {
          if (error?.data?.error === "codex_conflict") toast(L.apps.conflict(error.data.path));
          else throw error;
        } finally {
          busy.delete(app.id);
        }
      });
      return;
    }
    const action = target.dataset.action;
    if (action === "sheet-close") {
      sheet = null;
      renderSheet();
    } else if (action === "mcp-add" && mcp) {
      sheet = { type: "mcp-add", step: "form", draft: { type: "stdio", apps: presentApps(mcp, ["claude", "codex"]) } };
      renderSheet();
    } else if (action === "mcp-back") {
      sheet.step = "form";
      renderSheet();
    } else if (action === "mcp-install") {
      const draft = sheet.draft;
      busy.add("mcp-add");
      renderSheet();
      run(async () => {
        try {
          mcp = await api("POST", "/api/mcp", { name: draft.name, def: draftDef(draft), apps: draft.apps });
          toast(L.mcp.form.added(draft.name), L.mcp.restart);
          sheet = null;
        } catch (error) {
          if (sheet) sheet.step = "form";
          toast(L.error, errorText(L.mcp, error));
        } finally {
          busy.delete("mcp-add");
        }
      });
    } else if (action === "skill-gh" && skills) {
      sheet = { type: "skill-gh", preview: null, draft: { url: "", apps: presentApps(skills, ["claude", "codex"]) } };
      renderSheet();
    } else if (action === "skill-back") {
      sheet.preview = null;
      renderSheet();
    } else if (action === "skill-install") {
      const { preview, draft } = sheet;
      busy.add("skill-gh");
      renderSheet();
      run(async () => {
        try {
          skills = await api("POST", "/api/skills/install", { source: preview.source, apps: draft.apps });
          toast(L.skills.gh.installed(preview.name), L.skills.restart);
          sheet = null;
        } catch (error) {
          toast(L.error, errorText(L.skills, error));
        } finally {
          busy.delete("skill-gh");
        }
      });
    } else if (action === "rank-retry") {
      loadCatalog();
    } else if (action === "catalog-install") {
      const item = catalog.items.find((row) => row.id === sheet.id);
      const draft = sheet.draft;
      const missing = catalogVars(item).find((row) => row.required && !String(draft.values[row.name] ?? row.default ?? "").trim());
      if (missing) return toast(L.error, L.rank.errors.missing_value(missing.name));
      if (!draft.apps?.length) return toast(L.error, L.mcp.errors.no_apps);
      busy.add("catalog-install");
      renderSheet();
      run(async () => {
        try {
          await api("POST", "/api/catalog/install", { id: item.id, values: draft.values, apps: draft.apps });
          toast(L.rank.installed(item.title), L[draft.kind].restart);
          mcp = null;
          skills = null;
          await loadLibrary(draft.kind);
          await loadCatalog();
        } catch (error) {
          const code = error?.data?.error;
          toast(L.error, code === "missing_value" ? L.rank.errors.missing_value(error.data.detail) : L.rank.errors[code] || errorText(L[draft.kind], error));
        } finally {
          busy.delete("catalog-install");
        }
      });
    } else if (action === "catalog-manage") {
      const item = catalog.items.find((row) => row.id === sheet.id);
      view = item.kind === "SKILL" ? "skills" : "mcp";
      sheet = { type: view, id: item.name, confirm: false };
      render();
      loadLibrary(view);
    } else if (action === "remove-item") {
      removeItem();
    } else if (action === "key-form") {
      keyForm = !keyForm;
      render();
    } else if (action === "login") {
      run(async () => {
        const { url } = await api("POST", "/api/login", {});
        const opened = window.open(url, "_blank");
        if (opened) opened.opener = null;
        else location.href = url;
        await refresh();
      });
    } else if (action === "remove-key") {
      run(async () => {
        state = (await api("DELETE", "/api/key")).state;
        models = [];
        toast(L.account.removed);
      });
    } else if (action === "check") {
      busy.add("check");
      render();
      run(async () => {
        try {
          check = await api("POST", "/api/check", {});
        } finally {
          busy.delete("check");
        }
      });
    }
  });

  document.addEventListener("input", (event) => {
    const field = event.target.dataset?.field;
    if (field && sheet?.draft && field !== "type") sheet.draft[field] = event.target.value;
    const valueName = event.target.dataset?.value;
    if (valueName && sheet?.draft?.values) sheet.draft.values[valueName] = event.target.value;
    if (event.target.dataset?.search === "rank") {
      catalog.q = event.target.value;
      clearTimeout(loadCatalog.timer);
      loadCatalog.timer = setTimeout(loadCatalog, 350);
      return;
    }
    const kind = event.target.dataset?.search;
    if (kind) {
      search[kind] = event.target.value;
      $("#list").innerHTML = listHtml(kind);
    }
  });

  document.addEventListener("change", (event) => {
    if (!sheet?.draft) return;
    if (event.target.dataset?.field === "type") {
      sheet.draft.type = event.target.value;
      renderSheet();
    }
    const pick = event.target.dataset?.pick;
    if (pick) {
      const apps = new Set(sheet.draft.apps || []);
      if (event.target.checked) apps.add(pick);
      else apps.delete(pick);
      sheet.draft.apps = [...apps];
    }
  });

  $("#sheet").addEventListener("close", () => {
    sheet = null;
    document.body.appendChild($("#toast"));
  });

  document.addEventListener("submit", (event) => {
    if (event.target.id === "mcp-form") {
      event.preventDefault();
      const d = sheet.draft;
      const def = draftDef(d);
      const ok = /^[A-Za-z0-9_-]{1,64}$/.test(String(d.name || "")) && (def.type === "stdio" ? def.command : def.url);
      if (!ok) return toast(L.error, L.mcp.errors[/^[A-Za-z0-9_-]{1,64}$/.test(String(d.name || "")) ? "invalid_def" : "invalid_name"]);
      if (!d.apps.length) return toast(L.error, L.mcp.errors.no_apps);
      sheet.step = "review";
      renderSheet();
      return;
    }
    if (event.target.id === "skill-gh-form") {
      event.preventDefault();
      busy.add("skill-gh");
      renderSheet();
      const current = sheet;
      run(async () => {
        try {
          current.preview = await api("POST", "/api/skills/preview", { url: current.draft.url });
        } catch (error) {
          toast(L.error, errorText(L.skills, error));
        } finally {
          busy.delete("skill-gh");
        }
      });
      return;
    }
    if (event.target.id !== "key-form") return;
    event.preventDefault();
    const key = $("#key-input").value.trim();
    if (!key) return;
    run(async () => {
      try {
        const data = await api("POST", "/api/key", { key });
        state = data.state;
        keyForm = false;
        toast(data.verified ? L.account.saved : L.account.savedUnverified, updatedNote(data.reapplied));
        models = null;
        loadModels();
      } catch (error) {
        if (error?.data?.error === "invalid_key") toast(L.account.invalidKey);
        else throw error;
      }
    });
  });

  document.addEventListener("change", (event) => {
    if (event.target.id !== "model-select") return;
    const model = event.target.value;
    run(async () => {
      const data = await api("POST", "/api/model", { model });
      state = data.state;
      toast(L.account.modelSaved, updatedNote(data.reapplied));
    });
  });

  /* ── Khởi động ───────────────────────────────────────────────── */

  token = readToken();
  if (!token) {
    $("#pane").innerHTML = `<div class="empty">${icon("key", "lg", "gray")}<p>${esc(COPY.vi.noToken)}</p><p>${esc(COPY.en.noToken)}</p></div>`;
    return;
  }
  refresh()
    .then(() => {
      view = state.account.hasKey ? "apps" : "account";
      render();
      loadModels();
    })
    .catch((error) => {
      $("#pane").innerHTML = `<div class="empty">${icon("x", "lg", "red")}<p>${esc(error?.status === 401 ? COPY.vi.noToken : COPY.vi.closed)}</p></div>`;
    });
})();
