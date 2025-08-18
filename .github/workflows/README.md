# 🚀 GitHub Workflows para Blue Marble

Este diretório contém os workflows automatizados para o projeto Blue Marble.

## 📦 Release Workflow

### Como usar:
1. **Faça suas alterações** e commit normalmente
2. **Crie uma tag** que comece com "V":
   ```bash
   git tag V1.2.3
   git push origin V1.2.3
   ```
3. **O workflow roda automaticamente** e cria um release
4. **Download fica disponível** no GitHub Releases

### Exemplo de tags válidas:
- `V1.0.0` ✅
- `V2.1.3` ✅ 
- `V1.0.0-beta` ✅
- `v1.0.0` ❌ (deve ser maiúsculo)
- `1.0.0` ❌ (deve começar com V)

## 📁 Workflows Disponíveis

### `release.yml` (Clássico)
- Usa actions tradicionais (`actions/create-release`)
- Compatível com repositórios mais antigos
- Mais verboso mas estável

### `release-modern.yml` (Recomendado)  
- Usa GitHub CLI moderno
- Mais simples e rápido
- Melhor formatação e recursos

## 🎯 O que é criado automaticamente:

- ✅ **Release no GitHub** com notas automáticas
- ✅ **BlueMarble.user.js** como download
- ✅ **BlueMarble.user.css** como download opcional
- ✅ **Instruções de instalação** claras
- ✅ **Informações da versão** e changelog

## 🔧 Customização

Para personalizar os workflows, edite:
- **Trigger tags**: Mude o pattern em `tags: - 'V*'`
- **Arquivos incluídos**: Adicione mais arquivos na seção de upload
- **Release notes**: Modifique o template de notas
- **Título do release**: Ajuste o formato do título

## 🆘 Solução de Problemas

### Workflow não roda:
- ✅ Verifique se a tag começa com "V"
- ✅ Confirme que fez push da tag: `git push origin --tags`
- ✅ Verifique permissões do repositório

### Arquivo não encontrado:
- ✅ Confirme que `dist/BlueMarble.user.js` existe
- ✅ Execute build antes de criar a tag
- ✅ Verifique se o arquivo foi commitado

### Release não criado:
- ✅ Verifique nas Actions do GitHub se houve erro
- ✅ Confirme permissões de `contents: write`
- ✅ Verifique se o GITHUB_TOKEN tem acesso
