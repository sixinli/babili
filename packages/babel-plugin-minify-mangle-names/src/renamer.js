/**
 * Original Source - https://github.com/babel/babel/blob/master/packages/babel-traverse/src/scope/lib/renamer.js
 *
 * This one modifies it for one scenario -
 * check the parent of a ReferencedIdentifier and don't rename Labels
 *
 */
const t = require("babel-types");

let renameVisitor = {
  "ReferencedIdentifier|BindingIdentifier"(path, state) {
    const {node} = path;
    if (path.parentPath.isLabeledStatement({ label: node })
      || path.parentPath.isBreakStatement({ label: node })
      || path.parentPath.isContinueStatement({ label: node })
    ) {
      return;
    }
    if (node.name === state.oldName) {
      node.name = state.newName;
    }
  },

  Scope(path, state) {
    if (!path.scope.bindingIdentifierEquals(state.oldName, state.binding.identifier)) {
      path.skip();
    }
  },

  "AssignmentExpression|Declaration"(path, state) {
    let ids = path.getOuterBindingIdentifiers();

    for (let name in ids) {
      if (name === state.oldName) ids[name].name = state.newName;
    }
  }
};

module.exports = class Renamer {
  constructor(binding, oldName, newName) {
    this.newName = newName;
    this.oldName = oldName;
    this.binding = binding;
  }

  maybeConvertFromExportDeclaration(parentDeclar) {
    let exportDeclar = parentDeclar.parentPath.isExportDeclaration() && parentDeclar.parentPath;
    if (!exportDeclar) return;

    // build specifiers that point back to this export declaration
    let isDefault = exportDeclar.isExportDefaultDeclaration();

    if (isDefault && (parentDeclar.isFunctionDeclaration() ||
        parentDeclar.isClassDeclaration())&& !parentDeclar.node.id) {
      // Ensure that default class and function exports have a name so they have a identifier to
      // reference from the export specifier list.
      parentDeclar.node.id = parentDeclar.scope.generateUidIdentifier("default");
    }

    let bindingIdentifiers = parentDeclar.getOuterBindingIdentifiers();
    let specifiers = [];

    for (let name in bindingIdentifiers) {
      let localName = name === this.oldName ? this.newName : name;
      let exportedName = isDefault ? "default" : name;
      specifiers.push(t.exportSpecifier(t.identifier(localName), t.identifier(exportedName)));
    }

    let aliasDeclar = t.exportNamedDeclaration(null, specifiers);

    // hoist to the top if it's a function
    if (parentDeclar.isFunctionDeclaration()) {
      aliasDeclar._blockHoist = 3;
    }

    exportDeclar.insertAfter(aliasDeclar);
    exportDeclar.replaceWith(parentDeclar.node);
  }

  maybeConvertFromClassFunctionDeclaration(path) {
    return; // TODO

    // retain the `name` of a class/function declaration

    if (!path.isFunctionDeclaration() && !path.isClassDeclaration()) return;
    if (this.binding.kind !== "hoisted") return;

    path.node.id = t.identifier(this.oldName);
    path.node._blockHoist = 3;

    path.replaceWith(t.variableDeclaration("let", [
      t.variableDeclarator(t.identifier(this.newName), t.toExpression(path.node))
    ]));
  }

  maybeConvertFromClassFunctionExpression(path) {
    return; // TODO

    // retain the `name` of a class/function expression

    if (!path.isFunctionExpression() && !path.isClassExpression()) return;
    if (this.binding.kind !== "local") return;

    path.node.id = t.identifier(this.oldName);

    this.binding.scope.parent.push({
      id: t.identifier(this.newName)
    });

    path.replaceWith(t.assignmentExpression("=", t.identifier(this.newName), path.node));
  }

  rename(block) {
    let { binding, oldName, newName } = this;
    let { scope, path } = binding;

    let parentDeclar = path.find((path) => path.isDeclaration() || path.isFunctionExpression());
    if (parentDeclar) {
      this.maybeConvertFromExportDeclaration(parentDeclar);
    }

    scope.traverse(block || scope.block, renameVisitor, this);

    if (!block) {
      scope.removeOwnBinding(oldName);
      scope.bindings[newName] = binding;
      this.binding.identifier.name = newName;
    }

    if (binding.type === "hoisted") {
      // https://github.com/babel/babel/issues/2435
      // todo: hoist and convert function to a let
    }

    if (parentDeclar) {
      this.maybeConvertFromClassFunctionDeclaration(parentDeclar);
      this.maybeConvertFromClassFunctionExpression(parentDeclar);
    }
  }
};
