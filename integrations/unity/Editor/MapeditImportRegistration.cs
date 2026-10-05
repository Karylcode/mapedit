using System.Linq;
using UnityEditor;
using UnityEngine;
using UnityGLTF;

namespace Mapedit.Editor
{
    [InitializeOnLoad]
    public static class MapeditImportRegistration
    {
        static MapeditImportRegistration()
        {
            // Register after settings assets have been imported. This also repairs settings whose
            // plugin subasset references were lost while UnityGLTF created its first settings file.
            EditorApplication.delayCall += EnsureRegistered;
        }

        public static void EnsureRegistered()
        {
            if (AssetDatabase.IsAssetImportWorkerProcess()) return;
            var settings = GLTFSettings.GetOrCreateSettings();
            settings.ImportPlugins.RemoveAll(plugin => !plugin);
            var plugin = settings.ImportPlugins.OfType<MapeditImportPlugin>().FirstOrDefault();
            if (plugin) return;
            plugin = ScriptableObject.CreateInstance<MapeditImportPlugin>();
            plugin.name = nameof(MapeditImportPlugin);
            plugin.Enabled = true;
            plugin.hideFlags = HideFlags.HideInHierarchy | HideFlags.HideInInspector;
            settings.ImportPlugins.Add(plugin);
            if (AssetDatabase.Contains(settings)) AssetDatabase.AddObjectToAsset(plugin, settings);
            EditorUtility.SetDirty(settings);
            AssetDatabase.SaveAssets();
        }
    }
}
