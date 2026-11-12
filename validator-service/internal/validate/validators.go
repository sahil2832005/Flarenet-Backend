package validate

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"golang.org/x/sync/errgroup"
)

// ValidatorResult holds the outcome of a single validator.
type ValidatorResult struct {
	Status  string `json:"status"`  // "pass" | "fail"
	Message string `json:"message,omitempty"`
}

// ValidationResults holds outcomes from all 6 validators.
type ValidationResults struct {
	Structure  ValidatorResult `json:"structure"`
	PackageJSON ValidatorResult `json:"packageJson"`
	Secrets    ValidatorResult `json:"secrets"`
	Malware    ValidatorResult `json:"malware"`
	AST        ValidatorResult `json:"ast"`
	NodeJSOnly ValidatorResult `json:"nodejsOnly"`

	// Extracted metadata used for the manifest.
	Entrypoint   string   `json:"entrypoint"`
	NodeVersion  string   `json:"nodeVersion"`
	Dependencies []string `json:"dependencies"`
}

// runValidators runs all 6 validators in parallel.
// Returns error if ANY validator fails (hard failure = unsafe to deploy).
func runValidators(ctx context.Context, repoDir string) (*ValidationResults, error) {
	r := &ValidationResults{}

	g, ctx := errgroup.WithContext(ctx)

	g.Go(func() error {
		res, entry := validateStructure(repoDir)
		r.Structure = res
		r.Entrypoint = entry
		if res.Status == "fail" {
			return fmt.Errorf("structure: %s", res.Message)
		}
		return nil
	})

	g.Go(func() error {
		res, nodeVer, deps := validatePackageJSON(repoDir)
		r.PackageJSON = res
		r.NodeVersion = nodeVer
		r.Dependencies = deps
		if res.Status == "fail" {
			return fmt.Errorf("packageJson: %s", res.Message)
		}
		return nil
	})

	g.Go(func() error {
		res := validateSecrets(repoDir)
		r.Secrets = res
		if res.Status == "fail" {
			return fmt.Errorf("secrets: %s", res.Message)
		}
		return nil
	})

	g.Go(func() error {
		res := validateMalware(repoDir)
		r.Malware = res
		if res.Status == "fail" {
			return fmt.Errorf("malware: %s", res.Message)
		}
		return nil
	})

	g.Go(func() error {
		res := validateAST(repoDir)
		r.AST = res
		if res.Status == "fail" {
			return fmt.Errorf("ast: %s", res.Message)
		}
		return nil
	})

	g.Go(func() error {
		res := validateNodeJSOnly(repoDir)
		r.NodeJSOnly = res
		if res.Status == "fail" {
			return fmt.Errorf("nodejsOnly: %s", res.Message)
		}
		return nil
	})

	if err := g.Wait(); err != nil {
		return r, err
	}
	return r, nil
}

// ── Validator 1: Structure ───────────────────────────────────────────────────

func validateStructure(repoDir string) (ValidatorResult, string) {
	// Must have package.json.
	pkgPath := filepath.Join(repoDir, "package.json")
	if _, err := os.Stat(pkgPath); err != nil {
		return fail("missing package.json"), ""
	}

	// Read package.json to find entry point.
	data, err := os.ReadFile(pkgPath)
	if err != nil {
		return fail("cannot read package.json"), ""
	}

	var pkg map[string]any
	if err := json.Unmarshal(data, &pkg); err != nil {
		return fail("package.json is not valid JSON"), ""
	}

	// Determine entry point: main > scripts.start > index.js fallback.
	entrypoint := "index.js"
	if main, ok := pkg["main"].(string); ok && main != "" {
		entrypoint = main
	} else if scripts, ok := pkg["scripts"].(map[string]any); ok {
		if start, ok := scripts["start"].(string); ok && start != "" {
			// Extract file from "node src/index.js" → "src/index.js"
			parts := strings.Fields(start)
			for i, p := range parts {
				if p == "node" && i+1 < len(parts) {
					entrypoint = parts[i+1]
					break
				}
			}
		}
	}

	// Verify the entry point file actually exists.
	entryPath := filepath.Join(repoDir, entrypoint)
	if _, err := os.Stat(entryPath); err != nil {
		return fail(fmt.Sprintf("entry point %q not found", entrypoint)), ""
	}

	return pass(), entrypoint
}

// ── Validator 2: package.json ────────────────────────────────────────────────

func validatePackageJSON(repoDir string) (ValidatorResult, string, []string) {
	data, err := os.ReadFile(filepath.Join(repoDir, "package.json"))
	if err != nil {
		return fail("cannot read package.json"), "", nil
	}

	var pkg map[string]any
	if err := json.Unmarshal(data, &pkg); err != nil {
		return fail("invalid JSON in package.json"), "", nil
	}

	// Must have name.
	if name, ok := pkg["name"].(string); !ok || strings.TrimSpace(name) == "" {
		return fail("package.json missing 'name' field"), "", nil
	}

	// Must have either main or scripts.start.
	hasMain := false
	hasStart := false
	if m, ok := pkg["main"].(string); ok && m != "" {
		hasMain = true
	}
	if scripts, ok := pkg["scripts"].(map[string]any); ok {
		if s, ok := scripts["start"].(string); ok && s != "" {
			hasStart = true
		}
	}
	if !hasMain && !hasStart {
		return fail("package.json must have 'main' or 'scripts.start'"), "", nil
	}

	// Extract node engine version if specified.
	nodeVersion := ""
	if engines, ok := pkg["engines"].(map[string]any); ok {
		if nv, ok := engines["node"].(string); ok {
			nodeVersion = nv
		}
	}

	// Collect dependency names.
	deps := collectDeps(pkg)

	return pass(), nodeVersion, deps
}

func collectDeps(pkg map[string]any) []string {
	seen := map[string]bool{}
	var deps []string
	for _, key := range []string{"dependencies", "devDependencies", "peerDependencies"} {
		if section, ok := pkg[key].(map[string]any); ok {
			for name := range section {
				if !seen[name] {
					seen[name] = true
					deps = append(deps, name)
				}
			}
		}
	}
	return deps
}

// ── Validator 3: Secrets ─────────────────────────────────────────────────────

var secretPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)(api[_-]?key|apikey)\s*[:=]\s*["']?[A-Za-z0-9/+]{20,}`),
	regexp.MustCompile(`(?i)(secret|password|passwd|pwd)\s*[:=]\s*["'][^"']{8,}`),
	regexp.MustCompile(`(?i)aws[_-]?(access[_-]?key|secret)[_-]?(id|key)?\s*[:=]\s*["']?[A-Z0-9]{16,}`),
	regexp.MustCompile(`sk-[a-zA-Z0-9]{32,}`),                     // OpenAI keys
	regexp.MustCompile(`ghp_[a-zA-Z0-9]{36}`),                     // GitHub PATs
	regexp.MustCompile(`eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}`), // JWTs hardcoded
}

// .env files that contain actual values (not just placeholders).
var envValuePattern = regexp.MustCompile(`^[A-Z_]+=.{3,}`)

func validateSecrets(repoDir string) ValidatorResult {
	var found []string

	err := filepath.WalkDir(repoDir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}

		name := d.Name()
		rel, _ := filepath.Rel(repoDir, path)

		// Skip .git internals and node_modules.
		if strings.Contains(rel, ".git/") || strings.Contains(rel, "node_modules/") {
			return nil
		}

		// Flag .env files that contain real values.
		if name == ".env" || strings.HasPrefix(name, ".env.") {
			if name != ".env.example" && name != ".env.sample" && name != ".env.template" {
				data, _ := os.ReadFile(path)
				for _, line := range strings.Split(string(data), "\n") {
					line = strings.TrimSpace(line)
					if envValuePattern.MatchString(line) && !strings.HasPrefix(line, "#") {
						found = append(found, fmt.Sprintf("%s contains real env values", rel))
						return nil
					}
				}
			}
		}

		// Only scan text-like files.
		ext := strings.ToLower(filepath.Ext(name))
		if !isTextFile(ext) {
			return nil
		}

		data, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		content := string(data)

		for _, pat := range secretPatterns {
			if pat.MatchString(content) {
				found = append(found, fmt.Sprintf("%s matches secret pattern", rel))
				return nil
			}
		}
		return nil
	})

	if err != nil {
		return fail(fmt.Sprintf("secrets scan error: %v", err))
	}
	if len(found) > 0 {
		return fail(fmt.Sprintf("potential secrets found: %s", strings.Join(found, "; ")))
	}
	return pass()
}

// ── Validator 4: Malware ─────────────────────────────────────────────────────

var malwarePatterns = []*regexp.Regexp{
	// Crypto miner signatures.
	regexp.MustCompile(`(?i)(coinhive|cryptonight|stratum\+tcp|monero)`),
	// Reverse shell patterns.
	regexp.MustCompile(`(?i)(\/bin\/sh|\/bin\/bash|nc\s+-[el]|bash\s+-i\s+>&)`),
	// Exfiltration via exec with external URLs.
	regexp.MustCompile(`child_process.*exec.*https?://`),
	// Obfuscated eval bombs.
	regexp.MustCompile(`eval\s*\(\s*(?:Buffer\.from|atob|unescape)\s*\(`),
	// Writing to /etc/passwd or /etc/hosts.
	regexp.MustCompile(`(?i)(\/etc\/passwd|\/etc\/shadow|\/etc\/hosts)`),
	// Mass file deletion.
	regexp.MustCompile(`(?i)(rm\s+-rf\s+\/|rmdir\s+\/|fs\.rmSync\s*\(\s*['"]\/)`),
}

func validateMalware(repoDir string) ValidatorResult {
	var found []string

	err := filepath.WalkDir(repoDir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}

		rel, _ := filepath.Rel(repoDir, path)
		if strings.Contains(rel, ".git/") || strings.Contains(rel, "node_modules/") {
			return nil
		}

		ext := strings.ToLower(filepath.Ext(d.Name()))
		if !isTextFile(ext) {
			return nil
		}

		data, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		content := string(data)

		for _, pat := range malwarePatterns {
			if pat.MatchString(content) {
				found = append(found, fmt.Sprintf("%s: suspicious pattern detected", rel))
				return nil
			}
		}
		return nil
	})

	if err != nil {
		return fail(fmt.Sprintf("malware scan error: %v", err))
	}
	if len(found) > 0 {
		return fail(fmt.Sprintf("malware signatures found: %s", strings.Join(found, "; ")))
	}
	return pass()
}

// ── Validator 5: AST (static analysis) ──────────────────────────────────────
// Pure text-based heuristics — no actual JS parser needed for these checks.

var astDangerPatterns = []*regexp.Regexp{
	// process.exit() called at module level (not inside a function/handler).
	regexp.MustCompile(`^process\.exit\(`),
	// Dangerous use of __dirname to escape to system paths.
	regexp.MustCompile(`(?i)__dirname.*\.\.(\/\.\.){2,}`),
	// require() loading from absolute system paths.
	regexp.MustCompile(`require\s*\(\s*['"]\/etc\/`),
	// setTimeout/setInterval with 0 delay and infinite recursion hint.
	regexp.MustCompile(`setInterval\s*\([^,]+,\s*0\s*\)`),
}

func validateAST(repoDir string) ValidatorResult {
	var found []string

	err := filepath.WalkDir(repoDir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}

		rel, _ := filepath.Rel(repoDir, path)
		if strings.Contains(rel, ".git/") || strings.Contains(rel, "node_modules/") {
			return nil
		}

		ext := strings.ToLower(filepath.Ext(d.Name()))
		if ext != ".js" && ext != ".mjs" && ext != ".cjs" && ext != ".ts" {
			return nil
		}

		data, err := os.ReadFile(path)
		if err != nil {
			return nil
		}

		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "//") || strings.HasPrefix(line, "*") {
				continue
			}
			for _, pat := range astDangerPatterns {
				if pat.MatchString(line) {
					found = append(found, fmt.Sprintf("%s: %s", rel, line))
					return nil
				}
			}
		}
		return nil
	})

	if err != nil {
		return fail(fmt.Sprintf("ast scan error: %v", err))
	}
	if len(found) > 0 {
		return fail(fmt.Sprintf("dangerous patterns found: %s", strings.Join(found, "; ")))
	}
	return pass()
}

// ── Validator 6: Node.js only ────────────────────────────────────────────────

// Non-JS source file extensions that indicate a non-Node.js project.
var foreignSourceExts = map[string]string{
	".py":   "Python",
	".rb":   "Ruby",
	".php":  "PHP",
	".go":   "Go",
	".java": "Java",
	".cs":   "C#",
	".rs":   "Rust",
	".cpp":  "C++",
	".c":    "C",
}

func validateNodeJSOnly(repoDir string) ValidatorResult {
	var foreign []string

	err := filepath.WalkDir(repoDir, func(path string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}

		rel, _ := filepath.Rel(repoDir, path)
		if strings.Contains(rel, ".git/") || strings.Contains(rel, "node_modules/") {
			return nil
		}

		ext := strings.ToLower(filepath.Ext(d.Name()))
		if lang, bad := foreignSourceExts[ext]; bad {
			foreign = append(foreign, fmt.Sprintf("%s (%s)", rel, lang))
		}
		return nil
	})

	if err != nil {
		return fail(fmt.Sprintf("nodejs-only scan error: %v", err))
	}
	if len(foreign) > 0 {
		return fail(fmt.Sprintf("non-Node.js source files found: %s", strings.Join(foreign, ", ")))
	}
	return pass()
}

// ── Helpers ──────────────────────────────────────────────────────────────────

func pass() ValidatorResult {
	return ValidatorResult{Status: "pass"}
}

func fail(msg string) ValidatorResult {
	return ValidatorResult{Status: "fail", Message: msg}
}

func isTextFile(ext string) bool {
	textExts := map[string]bool{
		".js": true, ".mjs": true, ".cjs": true, ".ts": true,
		".jsx": true, ".tsx": true, ".json": true, ".env": true,
		".yml": true, ".yaml": true, ".toml": true, ".txt": true,
		".md": true, ".sh": true, ".html": true, ".css": true,
	}
	return textExts[ext] || ext == ""
}
