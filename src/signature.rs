use serde_json::{Value, json};
use typst::World;
use typst::foundations::{Func, ParamInfo, Repr, Value as TypstValue};
use typst::syntax::ast::AstNode;
use typst::syntax::{LinkedNode, Side, Source, SyntaxKind, ast};

use crate::world::MemoryWorld;

/// Only publish parameters proven to belong to an unbound function. Typst's
/// Func::params forwards the original parameters through `.with(...)` wrappers.
fn unbound(world: &MemoryWorld, func: &Func) -> bool {
    if func.contextual().is_some() || func.to_element().is_some() || func.to_plugin().is_some() {
        return true;
    }
    let Some(id) = func.span().id() else {
        return false;
    };
    let Ok(source) = world.source(id) else {
        return false;
    };
    let Some(params) = LinkedNode::new(source.root()).find(func.span()) else {
        return false;
    };
    let Some(closure) = params
        .parent()
        .filter(|node| node.cast::<ast::Closure>().is_some())
    else {
        return false;
    };
    // Native closure evaluation attaches its parameter span to the Func. Exact
    // semantic equality excludes With wrappers, including aliases of wrappers.
    typst_ide::analyze_expr(world, closure)
        .iter()
        .any(|(value, _)| matches!(value, TypstValue::Func(candidate) if candidate == func))
}

fn positional(params: &[ParamInfo], position: usize) -> Option<usize> {
    let mut index = 0;
    for (parameter, info) in params.iter().enumerate() {
        if !info.positional() {
            continue;
        }
        if index == position || info.variadic() {
            return Some(parameter);
        }
        index += 1;
    }
    None
}

fn active_parameter(args: &LinkedNode<'_>, byte: usize, params: &[ParamInfo]) -> Option<usize> {
    enum Argument {
        Positional,
        Named(Option<usize>),
        Spread,
    }
    let mut position = 0;
    let mut unknown = args.cast::<ast::MathArgs>().is_some_and(|math| {
        math.content_items()
            .any(|item| matches!(item, ast::MathArgItem::Semicolon(_, _)))
    });
    let mut current = None;
    for node in args.children() {
        if node.offset() > byte {
            break;
        }
        if node.kind() == SyntaxKind::Comma {
            if node.range().end > byte {
                break;
            }
            match current.take() {
                Some(Argument::Positional) => position += 1,
                Some(Argument::Spread) => unknown = true,
                _ => {}
            }
        } else if let Some(argument) = node.cast::<ast::Arg>() {
            // Trailing content blocks are consecutive positional arguments,
            // without a separating comma: f(a)[b] and f[a][b].
            match current.take() {
                Some(Argument::Positional) => position += 1,
                Some(Argument::Spread) => unknown = true,
                _ => {}
            }
            current = Some(match argument {
                ast::Arg::Named(named) => Argument::Named(params.iter().position(|param| {
                    param.named() && param.name() == Some(named.name().as_str())
                })),
                ast::Arg::Pos(_) => Argument::Positional,
                ast::Arg::Spread(_) => Argument::Spread,
            });
        }
    }
    match current {
        Some(Argument::Named(parameter)) => parameter,
        Some(Argument::Spread) => None,
        _ if !unknown => positional(params, position),
        _ => None,
    }
}

pub fn signature(world: &MemoryWorld, source: &Source, byte: usize, revision: u32) -> Value {
    let root = LinkedNode::new(source.root());
    let mut byte = byte;
    let Some(mut node) = root.leaf_at(byte, Side::Before) else {
        return Value::Null;
    };
    // Recovery puts trailing whitespace outside an unfinished call. Walk only
    // native whitespace back to its boundary; never guess a call from text.
    while matches!(node.kind(), SyntaxKind::Space | SyntaxKind::Parbreak) && node.offset() > 0 {
        byte = node.offset();
        let Some(previous) = root.leaf_at(byte, Side::Before) else {
            return Value::Null;
        };
        node = previous;
    }
    loop {
        let spans = node
            .cast::<ast::FuncCall>()
            .map(|call| (call.args().span(), call.callee().span()))
            .or_else(|| {
                node.cast::<ast::MathCall>()
                    .map(|call| (call.args().span(), call.callee().span()))
            });
        if let Some((argument_span, callee_span)) = spans {
            let args = node.children().find(|child| child.span() == argument_span);
            let callee = node.children().find(|child| child.span() == callee_span);
            if let (Some(args), Some(callee)) = (args, callee) {
                let range = args.range();
                let closed = args.children().next_back().is_some_and(|last| {
                    last.kind() == SyntaxKind::RightParen
                        || (last.kind() == SyntaxKind::ContentBlock
                            && last
                                .children()
                                .next_back()
                                .is_some_and(|end| end.kind() == SyntaxKind::RightBracket))
                });
                if byte > range.start && (byte < range.end || (!closed && byte == range.end)) {
                    let mut functions = Vec::new();
                    for (value, _) in typst_ide::analyze_expr(world, &callee) {
                        if let TypstValue::Func(func) = value
                            && unbound(world, &func)
                            && !functions.contains(&func)
                        {
                            functions.push(func);
                        }
                    }
                    let signatures: Vec<_> = functions.iter().map(|func| {
                        let params: Vec<_> = func.params().collect();
                        let parameters: Vec<_> = params.iter().map(|param| {
                            let name = param.name().unwrap_or("arguments");
                            let label = if param.variadic() { format!("..{name}") }
                                else if param.named() && !param.positional() {
                                    match param.default() { Some(default) => format!("{name}: {}", default.repr()), None => format!("{name}:") }
                                } else { name.to_owned() };
                            json!({"label":label,"documentation":param.to_native().map(|p| p.docs)})
                        }).collect();
                        let labels: Vec<_> = parameters.iter().map(|p| p["label"].as_str().unwrap_or("")).collect();
                        json!({"label":format!("{}({})",func.name().unwrap_or("function"),labels.join(", ")),
                            "documentation":func.docs(),"parameters":parameters,
                            "activeParameter":active_parameter(&args,byte,&params)})
                    }).collect();
                    return if signatures.is_empty() {
                        Value::Null
                    } else {
                        json!({"revision":revision,"signatures":signatures,"activeSignature":0})
                    };
                }
            }
        }
        match node.parent() {
            Some(parent) => node = parent.clone(),
            None => return Value::Null,
        }
    }
}
