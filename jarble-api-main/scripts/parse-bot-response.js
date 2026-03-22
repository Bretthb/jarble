// Parse bot JSON response from stdin and extract component analysis
let d = "";
process.stdin.on("data", (c) => (d += c));
process.stdin.on("end", () => {
  try {
    const p = JSON.parse(d);
    const t = p.result.payloads[0].text;
    const ms = p.result.meta.durationMs;
    console.log("Duration:", ms + "ms");
    console.log("Model:", p.result.meta.agentMeta.model);

    const re = /```jarble_ui\s*\n([\s\S]*?)```/g;
    let m;
    const blocks = [];
    while ((m = re.exec(t)) !== null) {
      try { blocks.push(JSON.parse(m[1].trim())); } catch {}
    }
    console.log("Components:", blocks.length);
    for (const b of blocks) {
      console.log("  Type:", b.component, "| layout:", b.layout_hint);
      if (b.props) {
        console.log("    libraries:", b.props.libraries || "none");
        console.log("    moduleJs:", b.props.moduleJs ? "yes (" + b.props.moduleJs.length + " chars)" : "none");
        console.log("    importMap:", b.props.importMap ? JSON.stringify(b.props.importMap) : "none");
        console.log("    js:", b.props.js ? "yes (" + b.props.js.length + " chars)" : "none");
        // Check for bare globals
        const code = b.props.js || "";
        const globals = ["THREE", "d3", "Chart", "gsap", "p5", "Tone", "L"].filter(
          (g) => new RegExp("\\b" + g + "\\b").test(code)
        );
        if (globals.length > 0) {
          console.log("    bare globals in js:", globals.join(", "));
          if (!b.props.libraries && !b.props.moduleJs) {
            console.log("    >> AUTOFIX WOULD TRIGGER!");
          } else {
            console.log("    >> OK: covered by libraries/moduleJs");
          }
        }
      }
    }
  } catch (e) {
    console.log("Parse error:", e.message);
    console.log(d.substring(0, 300));
  }
});
