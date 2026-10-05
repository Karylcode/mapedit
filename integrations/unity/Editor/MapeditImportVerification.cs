using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEngine;
using UnityGLTF;

namespace Mapedit.Editor
{
    /// <summary>Batchmode smoke test against a real exported map; no frontend or AI required.</summary>
    public static class MapeditImportVerification
    {
        public static void Run()
        {
            try
            {
                var input = Environment.GetEnvironmentVariable("MAPEDIT_UNITY_GLB");
                if (string.IsNullOrEmpty(input) || !File.Exists(input))
                    throw new InvalidOperationException("MAPEDIT_UNITY_GLB must name an exported map GLB.");
                const string directory = "Assets/MapeditVerification";
                Directory.CreateDirectory(directory);
                var source = new GameObject("VerifiedPlayer");
                var prefab = PrefabUtility.SaveAsPrefabAsset(source, directory + "/VerifiedPlayer.prefab");
                UnityEngine.Object.DestroyImmediate(source);
                var mappingPath = directory + "/MapeditMarkerMapping.asset";
                var mapping = AssetDatabase.LoadAssetAtPath<MapeditMarkerMapping>(mappingPath);
                if (!mapping)
                {
                    mapping = ScriptableObject.CreateInstance<MapeditMarkerMapping>();
                    AssetDatabase.CreateAsset(mapping, mappingPath);
                }
                mapping.entries.Clear();
                mapping.entries.Add(new MapeditMarkerMapping.Entry { markerType = "spawn", prefab = prefab });
                EditorUtility.SetDirty(mapping);
                MapeditImportRegistration.EnsureRegistered();
                var settings = GLTFSettings.GetOrCreateSettings();
                var plugin = settings.ImportPlugins.OfType<MapeditImportPlugin>().FirstOrDefault();
                Require(plugin, "UnityGLTF discovered the Mapedit plugin");
                plugin.Enabled = true;
                plugin.markerMapping = mapping;
                EditorUtility.SetDirty(plugin);
                EditorUtility.SetDirty(settings);
                AssetDatabase.SaveAssets();

                var glbPath = directory + "/village.glb";
                File.Copy(input, glbPath, true);
                AssetDatabase.ImportAsset(glbPath, ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
                var imported = AssetDatabase.LoadAssetAtPath<GameObject>(glbPath);
                Require(imported, "GLB imported as a prefab");
                var colliders = imported.GetComponentsInChildren<MeshCollider>(true);
                Require(colliders.Length >= 2, "Terrain and modules have mesh colliders");
                Require(colliders.All(collider => collider.sharedMesh && collider.sharedMesh.vertexCount > 0), "Colliders contain actual imported mesh geometry");
                var markers = imported.GetComponentsInChildren<MapeditMarker>(true);
                var spawn = markers.FirstOrDefault(marker => marker.markerType == "spawn");
                Require(spawn, "Spawn marker metadata survived import");
                Require(spawn.transform.Find("VerifiedPlayer"), "Spawn marker resolves to the selected prefab");
                var trigger = markers.FirstOrDefault(marker => marker.markerType == "trigger");
                Require(trigger && trigger.GetComponent<BoxCollider>() && trigger.GetComponent<BoxCollider>().isTrigger, "Trigger marker has a trigger collider");
                Require(spawn.objectRef.StartsWith("marker:", StringComparison.Ordinal), "Stable marker reference survived import");
                Debug.Log($"MAPEDIT_UNITY_VERIFIED: {colliders.Length} mesh colliders, {markers.Length} markers, mapped spawn prefab, trigger collider.");
                File.WriteAllText(Path.Combine(Directory.GetCurrentDirectory(), "mapedit-verification.json"),
                    $"{{\"ok\":true,\"unity\":\"{Application.unityVersion}\",\"meshColliders\":{colliders.Length},\"markers\":{markers.Length},\"spawnPrefab\":true,\"trigger\":true}}");
                EditorApplication.Exit(0);
            }
            catch (Exception exception)
            {
                Debug.LogException(exception);
                EditorApplication.Exit(1);
            }
        }

        private static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException("Mapedit verification failed: " + message);
        }
    }
}
