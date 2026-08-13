// Command fetch-external pulls the user's articles from Zenn (RSS feed) and
// writes one Hugo content file per article into content/external/. Run from
// anywhere inside the repo:
//
//	cd tools/fetch-external && go run .
//
// The username comes from config/sources.json, overridable via the ZENN_USER
// environment variable. The program uses only the standard library.
package main

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

type sourcesConfig struct {
	Zenn string `json:"zenn"`
}

// article is the normalized shape written to a Hugo content file.
type article struct {
	Title    string
	URL      string
	Date     time.Time
	Tags     []string
	Source   string // "Zenn"
	Summary  string
	Slug     string
}

func main() {
	root, err := findRoot()
	if err != nil {
		fatal(err)
	}
	cfg := loadConfig(root)

	outDir := filepath.Join(root, "content", "external")
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		fatal(err)
	}

	var all []article

	if zUser := firstNonEmpty(os.Getenv("ZENN_USER"), cfg.Zenn); isConfigured(zUser) {
		items, err := fetchZenn(zUser)
		if err != nil {
			// content/external is not kept in Git, so continuing here would publish a
			// site with every external article missing. Stop before touching the
			// directory instead: CI fails and the previous deploy stays live.
			fatal(fmt.Errorf("zenn fetch failed (content/external left untouched): %w", err))
		}
		fmt.Printf("zenn: fetched %d items for @%s\n", len(items), zUser)
		all = append(all, items...)
	} else {
		fmt.Println("zenn: skipped (username not configured)")
	}

	// Remove previously generated files so deletions upstream propagate.
	if err := cleanGenerated(outDir); err != nil {
		fatal(err)
	}

	for _, a := range all {
		if err := writeArticle(outDir, a); err != nil {
			fatal(err)
		}
	}
	fmt.Printf("wrote %d external article(s) to %s\n", len(all), outDir)
}

// --- Zenn ------------------------------------------------------------------

type rss struct {
	Channel struct {
		Items []struct {
			Title       string `xml:"title"`
			Link        string `xml:"link"`
			PubDate     string `xml:"pubDate"`
			Description string `xml:"description"`
			Categories  []string `xml:"category"`
		} `xml:"item"`
	} `xml:"channel"`
}

func fetchZenn(user string) ([]article, error) {
	url := fmt.Sprintf("https://zenn.dev/%s/feed", user)
	req, _ := http.NewRequest(http.MethodGet, url, nil)
	body, err := doGet(req)
	if err != nil {
		return nil, err
	}
	var feed rss
	if err := xml.Unmarshal(body, &feed); err != nil {
		return nil, fmt.Errorf("decode zenn feed: %w", err)
	}
	var out []article
	for _, it := range feed.Channel.Items {
		out = append(out, article{
			Title:   strings.TrimSpace(it.Title),
			URL:     strings.TrimSpace(it.Link),
			Date:    parseRSSDate(it.PubDate),
			Tags:    it.Categories,
			Source:  "Zenn",
			Summary: summarize(it.Description),
			Slug:    "zenn-" + slugFromURL(it.Link),
		})
	}
	return out, nil
}

// --- output ----------------------------------------------------------------

func writeArticle(dir string, a article) error {
	// YAML front matter. externalUrl / source drive the custom layout.
	var b strings.Builder
	b.WriteString("---\n")
	fmt.Fprintf(&b, "title: %s\n", yamlString(a.Title))
	if !a.Date.IsZero() {
		fmt.Fprintf(&b, "date: %s\n", a.Date.Format(time.RFC3339))
	}
	b.WriteString("tags:\n")
	for _, t := range dedupe(a.Tags) {
		fmt.Fprintf(&b, "  - %s\n", yamlString(t))
	}
	fmt.Fprintf(&b, "sources:\n  - %s\n", yamlString(a.Source))
	fmt.Fprintf(&b, "externalUrl: %s\n", yamlString(a.URL))
	fmt.Fprintf(&b, "source: %s\n", yamlString(a.Source))
	fmt.Fprintf(&b, "summary: %s\n", yamlString(a.Summary))
	b.WriteString("layout: external\n")
	b.WriteString("---\n\n")
	b.WriteString(a.Summary)
	b.WriteString("\n")

	path := filepath.Join(dir, a.Slug+".md")
	return os.WriteFile(path, []byte(b.String()), 0o644)
}

// cleanGenerated removes .md files previously produced by this tool (all of
// content/external except _index.md).
func cleanGenerated(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	for _, e := range entries {
		if e.IsDir() || e.Name() == "_index.md" {
			continue
		}
		if strings.HasSuffix(e.Name(), ".md") {
			if err := os.Remove(filepath.Join(dir, e.Name())); err != nil {
				return err
			}
		}
	}
	return nil
}

// --- helpers ---------------------------------------------------------------

func findRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "hugo.toml")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("could not locate repo root (no hugo.toml found)")
		}
		dir = parent
	}
}

func loadConfig(root string) sourcesConfig {
	var cfg sourcesConfig
	data, err := os.ReadFile(filepath.Join(root, "config", "sources.json"))
	if err != nil {
		fmt.Fprintf(os.Stderr, "warn: could not read config/sources.json: %v\n", err)
		return cfg
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		fmt.Fprintf(os.Stderr, "warn: could not parse config/sources.json: %v\n", err)
	}
	return cfg
}

func doGet(req *http.Request) ([]byte, error) {
	req.Header.Set("User-Agent", "iwatsukayura-blog-fetcher/1.0")
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s -> HTTP %d: %s", req.URL, resp.StatusCode, truncate(string(body), 200))
	}
	return body, nil
}

var (
	tagRE = regexp.MustCompile(`<[^>]*>`)
	wsRE  = regexp.MustCompile(`\s+`)
)

func summarize(s string) string {
	s = tagRE.ReplaceAllString(s, " ")
	s = strings.ReplaceAll(s, "&nbsp;", " ")
	s = wsRE.ReplaceAllString(s, " ")
	s = strings.TrimSpace(s)
	return truncate(s, 160)
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return strings.TrimSpace(string(r[:n])) + "…"
}

func parseRSSDate(s string) time.Time {
	s = strings.TrimSpace(s)
	for _, layout := range []string{time.RFC1123Z, time.RFC1123, time.RFC822Z, time.RFC822} {
		if t, err := time.Parse(layout, s); err == nil {
			return t
		}
	}
	return time.Time{}
}

func slugFromURL(u string) string {
	u = strings.TrimRight(strings.TrimSpace(u), "/")
	parts := strings.Split(u, "/")
	if len(parts) == 0 {
		return "post"
	}
	last := parts[len(parts)-1]
	last = regexp.MustCompile(`[^a-zA-Z0-9_-]`).ReplaceAllString(last, "-")
	if last == "" {
		return "post"
	}
	return last
}

// yamlString quotes a value safely for YAML front matter.
func yamlString(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "\"", "\\\"")
	s = strings.ReplaceAll(s, "\n", " ")
	return "\"" + s + "\""
}

func dedupe(in []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range in {
		s = strings.TrimSpace(s)
		if s == "" || seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	sort.Strings(out)
	return out
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func isConfigured(user string) bool {
	return user != "" && !strings.HasPrefix(user, "CHANGE_ME")
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, "error:", err)
	os.Exit(1)
}
